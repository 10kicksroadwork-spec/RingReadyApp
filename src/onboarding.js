import {
  getCurrentUser,
  loadCloudHRInfo,
  loadCloudProfile,
  saveCloudHRInfo,
  saveCloudProfile,
  signOut,
} from './auth.js';
import {
  HR_INFO_DEFAULTS,
  HR_INFO_STORAGE_KEY,
} from './app-content.js';
import { isSupabaseConfigured, supabase } from './supabase-client.js';
import { getAthleteProfile, saveAthleteProfile } from './sync.js';

const ONBOARDING_SCREEN_ID = 'onboarding-gate';
const ONBOARDING_STYLE_ID = 'ring-ready-onboarding-styles';
const SIGNUP_NAME_WRAP_ID = 'auth-name-wrap';

let gateLocked = false;
let gateState = null;
let navigationGuardInstalled = false;

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    console.warn(`Could not read ${key}`, error);
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function text(value) {
  return String(value || '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setStatus(message = '', isError = false) {
  const status = document.getElementById('onboarding-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function setAuthStatus(message = '', isError = false) {
  const status = document.getElementById('auth-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function getUserMetadata(user = getCurrentUser()) {
  return user?.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {};
}

function getStoredHRInfo() {
  const saved = readJSON(HR_INFO_STORAGE_KEY, {});
  return {
    goalWeight: saved.goalWeight ?? HR_INFO_DEFAULTS.goalWeight,
    targetDate: saved.targetDate || HR_INFO_DEFAULTS.targetDate,
    maxHr: saved.maxHr ?? '',
    restingHr: saved.restingHr ?? '',
  };
}

function mergeProfile(localProfile, cloudProfile, metadata) {
  const choose = (cloudValue, localValue, metadataValue = '') =>
    text(cloudValue) || text(localValue) || text(metadataValue);

  return {
    athleteName: choose(
      cloudProfile?.athleteName,
      localProfile?.athleteName,
      metadata.full_name || metadata.athlete_name
    ),
    age: choose(cloudProfile?.age, localProfile?.age),
    gender: choose(cloudProfile?.gender, localProfile?.gender),
    genderDetail: choose(cloudProfile?.genderDetail, localProfile?.genderDetail),
    trainingTenure: choose(
      cloudProfile?.trainingTenure,
      localProfile?.trainingTenure
    ),
    primaryDiscipline: '',
    weightClass: '',
    fightDate: choose(cloudProfile?.fightDate, localProfile?.fightDate),
    campLength:
      String(cloudProfile?.campLength || localProfile?.campLength || '7') === '4'
        ? '4'
        : '7',
  };
}

function mergeHRInfo(localHR, cloudHR) {
  return {
    goalWeight: cloudHR?.goalWeight ?? localHR.goalWeight,
    targetDate: cloudHR?.targetDate || localHR.targetDate,
    maxHr: cloudHR?.maxHr ?? localHR.maxHr,
    restingHr: cloudHR?.restingHr ?? localHR.restingHr,
  };
}

function isProfileComplete(profile, metadata) {
  const age = number(profile.age);
  const hasFightStatus =
    Boolean(text(profile.fightDate)) || metadata.no_fight_scheduled === true;

  return Boolean(
    text(profile.athleteName) &&
      age !== null &&
      age > 0 &&
      text(profile.trainingTenure) &&
      ['4', '7'].includes(String(profile.campLength)) &&
      hasFightStatus
  );
}

function isHRComplete(hrInfo, cloudHR, metadata) {
  const maxHr = number(hrInfo.maxHr);
  const restingHr = number(hrInfo.restingHr);
  const hasSavedSource = Boolean(text(metadata.max_hr_source));
  const hasSavedHRRecord = Boolean(cloudHR);

  return Boolean(
    maxHr !== null &&
      restingHr !== null &&
      maxHr >= 100 &&
      maxHr <= 240 &&
      restingHr >= 30 &&
      restingHr <= 120 &&
      maxHr > restingHr &&
      (hasSavedSource || hasSavedHRRecord)
  );
}

async function updateMetadata(patch) {
  if (!supabase) return null;
  const user = getCurrentUser();
  const current = getUserMetadata(user);
  const { data, error } = await supabase.auth.updateUser({
    data: { ...current, ...patch },
  });
  if (error) throw error;
  return data.user || null;
}

function isCreateAccountMode() {
  return document
    .getElementById('auth-submit-btn')
    ?.textContent?.toUpperCase()
    .includes('CREATE');
}

function syncSignupNameVisibility() {
  const wrap = document.getElementById(SIGNUP_NAME_WRAP_ID);
  const input = document.getElementById('auth-name-input');
  if (!wrap || !input) return;

  const isSignUp = isCreateAccountMode();
  wrap.hidden = !isSignUp;
  input.required = isSignUp;
  input.disabled = !isSignUp;
}

function ensureSignupNameField() {
  const form = document.getElementById('auth-form');
  const emailWrap = document
    .getElementById('auth-email-input')
    ?.closest('.app-input-wrap');

  if (!form || !emailWrap || document.getElementById(SIGNUP_NAME_WRAP_ID)) {
    return;
  }

  const wrap = document.createElement('label');
  wrap.className = 'app-input-wrap';
  wrap.id = SIGNUP_NAME_WRAP_ID;
  wrap.htmlFor = 'auth-name-input';
  wrap.hidden = true;
  wrap.innerHTML = `
    <span>Full Name</span>
    <input
      type="text"
      id="auth-name-input"
      autocomplete="name"
      placeholder="First Last"
      maxlength="80"
      disabled
    >
  `;
  form.insertBefore(wrap, emailWrap);
}

async function handleSignupCapture(event) {
  if (!isCreateAccountMode()) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!isSupabaseConfigured || !supabase) {
    setAuthStatus('Account creation is not configured for this build.', true);
    return;
  }

  const fullName = text(document.getElementById('auth-name-input')?.value);
  const email = text(document.getElementById('auth-email-input')?.value);
  const password = String(
    document.getElementById('auth-password-input')?.value || ''
  );

  if (fullName.length < 2) {
    setAuthStatus('Enter your full name.', true);
    document.getElementById('auth-name-input')?.focus();
    return;
  }

  if (!email || password.length < 8) {
    setAuthStatus('Enter an email and password with at least 8 characters.', true);
    return;
  }

  const submit = document.getElementById('auth-submit-btn');
  if (submit) submit.disabled = true;
  setAuthStatus('Creating account...');

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          athlete_name: fullName,
        },
      },
    });

    if (error) throw error;

    saveAthleteProfile({ athleteName: fullName });

    if (data.session) {
      window.location.reload();
      return;
    }

    document.getElementById('auth-mode-toggle-btn')?.click();
    window.setTimeout(() => {
      setAuthStatus('Check your email to confirm the account, then sign in.');
    }, 0);
  } catch (error) {
    setAuthStatus(String(error?.message || error || 'Account creation failed.'), true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

export function installSignupNameCapture() {
  ensureSignupNameField();
  syncSignupNameVisibility();

  const form = document.getElementById('auth-form');
  form?.addEventListener('submit', handleSignupCapture, true);

  document.getElementById('auth-mode-toggle-btn')?.addEventListener('click', () => {
    window.setTimeout(syncSignupNameVisibility, 0);
  });

  const submit = document.getElementById('auth-submit-btn');
  if (submit) {
    new MutationObserver(syncSignupNameVisibility).observe(submit, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  }
}

function ensureStyles() {
  if (document.getElementById(ONBOARDING_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = ONBOARDING_STYLE_ID;
  style.textContent = `
    #${ONBOARDING_SCREEN_ID} {
      background: var(--black);
      overflow-y: auto;
      z-index: 2000;
    }

    .onboarding-gate-shell {
      width: min(100%, 760px);
      margin: 0 auto;
      padding: 28px 18px 56px;
    }

    .onboarding-gate-head {
      padding: 24px 20px;
      border: 1px solid rgba(245, 200, 66, 0.58);
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(245, 200, 66, 0.18), rgba(62, 207, 110, 0.06) 70%),
        var(--dark2);
      margin-bottom: 14px;
    }

    .onboarding-gate-head h1 {
      margin: 8px 0 10px;
      color: var(--white);
      font-family: Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif;
      font-size: clamp(42px, 10vw, 72px);
      line-height: 0.9;
    }

    .onboarding-gate-head p,
    .onboarding-step-copy {
      color: #d1d1d1;
      font-size: 14px;
      line-height: 1.5;
    }

    .onboarding-progress {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 14px 0;
    }

    .onboarding-progress div {
      border: 1px solid var(--grey);
      border-radius: 10px;
      background: var(--dark2);
      color: #9d9d9d;
      padding: 11px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      letter-spacing: 1.4px;
      text-transform: uppercase;
    }

    .onboarding-progress div.active,
    .onboarding-progress div.done {
      border-color: var(--gold);
      color: var(--white);
    }

    .onboarding-progress div.done {
      background: rgba(62, 207, 110, 0.12);
      border-color: var(--green);
    }

    .onboarding-gate-panel {
      background: var(--dark2);
      border: 1px solid var(--grey);
      border-radius: 14px;
      padding: 18px;
    }

    .onboarding-gate-panel[hidden] {
      display: none;
    }

    .onboarding-gate-panel h2 {
      color: var(--white);
      font-family: Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif;
      font-size: 34px;
      line-height: 0.95;
      margin: 7px 0 9px;
    }

    .onboarding-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 16px;
    }

    .onboarding-form-grid .wide {
      grid-column: 1 / -1;
    }

    .onboarding-check {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 54px;
      border: 1px solid var(--grey);
      border-radius: 12px;
      background: var(--dark);
      color: var(--white);
      padding: 12px 14px;
      cursor: pointer;
    }

    .onboarding-check input {
      width: 20px;
      height: 20px;
      accent-color: var(--gold);
    }

    .onboarding-check span {
      font-size: 14px;
      line-height: 1.35;
    }

    .onboarding-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }

    .onboarding-actions .start-btn {
      flex: 1;
      font-size: 22px;
      padding: 16px;
      border-radius: 12px;
    }

    .onboarding-secondary-btn {
      border: 1px solid var(--grey);
      border-radius: 12px;
      background: var(--dark);
      color: var(--white);
      padding: 12px 16px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 10px;
      letter-spacing: 1.4px;
      cursor: pointer;
    }

    .onboarding-status {
      min-height: 20px;
      margin-top: 12px;
      color: #c9c9c9;
      font-size: 13px;
      line-height: 1.4;
    }

    .onboarding-status.error {
      color: #ff7d7d;
    }

    @media (max-width: 560px) {
      .onboarding-form-grid {
        grid-template-columns: 1fr;
      }

      .onboarding-form-grid .wide {
        grid-column: auto;
      }

      .onboarding-actions {
        flex-direction: column;
      }
    }
  `;
  document.head.appendChild(style);
}

function ensureScreen() {
  if (document.getElementById(ONBOARDING_SCREEN_ID)) return;

  const screen = document.createElement('div');
  screen.id = ONBOARDING_SCREEN_ID;
  screen.className = 'screen';
  screen.innerHTML = `
    <div class="onboarding-gate-shell">
      <section class="onboarding-gate-head">
        <div class="field-label">Required Setup</div>
        <h1>Build your fighter profile.</h1>
        <p>Ring Ready uses your camp details and heart-rate numbers to personalize the plan. Complete both steps before entering the app.</p>
      </section>

      <div class="onboarding-progress" aria-label="Setup progress">
        <div id="onboarding-progress-profile">1. Athlete Profile</div>
        <div id="onboarding-progress-hr">2. HR Setup</div>
      </div>

      <section class="onboarding-gate-panel" id="onboarding-profile-step">
        <div class="field-label">Step 1 of 2</div>
        <h2>Athlete Profile</h2>
        <p class="onboarding-step-copy">Enter the information your coach needs to identify you and organize your camp.</p>

        <div class="onboarding-form-grid">
          <label class="app-input-wrap wide" for="onboarding-name-input">
            <span>Full Name</span>
            <input type="text" id="onboarding-name-input" autocomplete="name" placeholder="First Last" maxlength="80">
          </label>

          <label class="app-input-wrap" for="onboarding-age-input">
            <span>Age</span>
            <input type="number" id="onboarding-age-input" inputmode="numeric" min="1" max="99" placeholder="--">
          </label>

          <label class="app-input-wrap" for="onboarding-tenure-select">
            <span>Training Tenure</span>
            <select id="onboarding-tenure-select">
              <option value="">Select</option>
              <option value="Less than 6 months">Less than 6 months</option>
              <option value="6-12 months">6-12 months</option>
              <option value="1-3 years">1-3 years</option>
              <option value="3-5 years">3-5 years</option>
              <option value="5+ years">5+ years</option>
            </select>
          </label>

          <label class="app-input-wrap" for="onboarding-gender-select">
            <span>Gender (Optional)</span>
            <select id="onboarding-gender-select">
              <option value="">Select</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Non-binary">Non-binary</option>
              <option value="Prefer not to say">Prefer not to say</option>
              <option value="Self describe">Self describe</option>
            </select>
          </label>

          <label class="app-input-wrap" for="onboarding-camp-length-select">
            <span>Camp Length</span>
            <select id="onboarding-camp-length-select">
              <option value="7">7 Week Camp</option>
              <option value="4">4 Week Camp</option>
            </select>
          </label>

          <label class="app-input-wrap wide" for="onboarding-fight-date-input">
            <span>Fight Date</span>
            <input type="date" id="onboarding-fight-date-input">
          </label>

          <label class="onboarding-check wide" for="onboarding-no-fight-input">
            <input type="checkbox" id="onboarding-no-fight-input">
            <span>I do not currently have a fight scheduled.</span>
          </label>
        </div>

        <div class="onboarding-actions">
          <button type="button" class="start-btn" id="onboarding-profile-next-btn">SAVE &amp; CONTINUE</button>
        </div>
      </section>

      <section class="onboarding-gate-panel" id="onboarding-hr-step" hidden>
        <div class="field-label">Step 2 of 2</div>
        <h2>Heart-Rate Setup</h2>
        <p class="onboarding-step-copy">These values set the training zones used throughout Ring Ready. Use tested numbers whenever possible.</p>

        <div class="onboarding-form-grid">
          <label class="app-input-wrap" for="onboarding-max-hr-input">
            <span>Max HR</span>
            <input type="number" id="onboarding-max-hr-input" inputmode="numeric" min="100" max="240" placeholder="--">
          </label>

          <label class="app-input-wrap" for="onboarding-resting-hr-input">
            <span>Resting HR</span>
            <input type="number" id="onboarding-resting-hr-input" inputmode="numeric" min="30" max="120" placeholder="--">
          </label>

          <label class="app-input-wrap wide" for="onboarding-max-source-select">
            <span>How Was Max HR Established?</span>
            <select id="onboarding-max-source-select">
              <option value="">Select</option>
              <option value="Mile Test">Mile Test</option>
              <option value="Other tested value">Other tested value</option>
              <option value="Estimated / manual value">Estimated / manual value</option>
            </select>
          </label>
        </div>

        <div class="onboarding-actions">
          <button type="button" class="onboarding-secondary-btn" id="onboarding-back-btn">BACK</button>
          <button type="button" class="start-btn" id="onboarding-finish-btn">ENTER RING READY</button>
        </div>
      </section>

      <div class="onboarding-status" id="onboarding-status" role="status"></div>
      <button type="button" class="onboarding-secondary-btn" id="onboarding-signout-btn">SIGN OUT</button>
    </div>
  `;

  document.getElementById('app')?.appendChild(screen);
}

function installNavigationGuard() {
  if (navigationGuardInstalled) return;
  navigationGuardInstalled = true;

  document.addEventListener(
    'click',
    (event) => {
      if (!gateLocked) return;
      const blocked = event.target.closest(
        '[data-page-target], [data-open-menu], #open-sprint-setup-btn, #detail-action-btn'
      );
      if (!blocked) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    true
  );
}

function setStep(step) {
  const profileStep = document.getElementById('onboarding-profile-step');
  const hrStep = document.getElementById('onboarding-hr-step');
  const profileProgress = document.getElementById('onboarding-progress-profile');
  const hrProgress = document.getElementById('onboarding-progress-hr');

  if (!profileStep || !hrStep || !profileProgress || !hrProgress) return;

  const isProfile = step === 'profile';
  profileStep.hidden = !isProfile;
  hrStep.hidden = isProfile;
  profileProgress.className = isProfile ? 'active' : 'done';
  hrProgress.className = isProfile ? '' : 'active';
  setStatus('');
}

function fillGateInputs(state) {
  const { profile, hrInfo, metadata } = state;

  document.getElementById('onboarding-name-input').value =
    profile.athleteName || metadata.full_name || metadata.athlete_name || '';
  document.getElementById('onboarding-age-input').value = profile.age || '';
  document.getElementById('onboarding-tenure-select').value =
    profile.trainingTenure || '';
  document.getElementById('onboarding-gender-select').value =
    profile.gender || '';
  document.getElementById('onboarding-camp-length-select').value =
    profile.campLength || '7';
  document.getElementById('onboarding-fight-date-input').value =
    profile.fightDate || '';
  document.getElementById('onboarding-no-fight-input').checked =
    metadata.no_fight_scheduled === true;

  const noFight = document.getElementById('onboarding-no-fight-input').checked;
  const fightDate = document.getElementById('onboarding-fight-date-input');
  fightDate.disabled = noFight;

  document.getElementById('onboarding-max-hr-input').value =
    hrInfo.maxHr || '';
  document.getElementById('onboarding-resting-hr-input').value =
    hrInfo.restingHr || '';
  document.getElementById('onboarding-max-source-select').value =
    metadata.max_hr_source || (state.cloudHR ? 'Other tested value' : '');
}

async function saveProfileStep() {
  if (!gateState) return;

  const athleteName = text(
    document.getElementById('onboarding-name-input')?.value
  );
  const age = number(document.getElementById('onboarding-age-input')?.value);
  const trainingTenure = text(
    document.getElementById('onboarding-tenure-select')?.value
  );
  const gender = text(
    document.getElementById('onboarding-gender-select')?.value
  );
  const campLength =
    String(document.getElementById('onboarding-camp-length-select')?.value) ===
    '4'
      ? '4'
      : '7';
  const noFightScheduled = Boolean(
    document.getElementById('onboarding-no-fight-input')?.checked
  );
  const fightDate = noFightScheduled
    ? ''
    : text(document.getElementById('onboarding-fight-date-input')?.value);

  if (athleteName.length < 2) {
    setStatus('Enter your full name.', true);
    return;
  }

  if (age === null || age < 1 || age > 99) {
    setStatus('Enter a valid age.', true);
    return;
  }

  if (!trainingTenure) {
    setStatus('Select your training tenure.', true);
    return;
  }

  if (!fightDate && !noFightScheduled) {
    setStatus('Enter a fight date or select no fight scheduled.', true);
    return;
  }

  const button = document.getElementById('onboarding-profile-next-btn');
  if (button) button.disabled = true;
  setStatus('Saving athlete profile...');

  try {
    const profile = saveAthleteProfile({
      athleteName,
      age: String(age),
      gender,
      genderDetail: '',
      trainingTenure,
      primaryDiscipline: '',
      weightClass: '',
      fightDate,
      campLength,
    });

    const cloudProfile = await saveCloudProfile(profile);
    await updateMetadata({
      full_name: athleteName,
      athlete_name: athleteName,
      no_fight_scheduled: noFightScheduled,
    });

    gateState.profile = cloudProfile || profile;
    gateState.metadata = {
      ...gateState.metadata,
      full_name: athleteName,
      athlete_name: athleteName,
      no_fight_scheduled: noFightScheduled,
    };

    setStep('hr');
  } catch (error) {
    console.warn('Required profile save failed', error);
    setStatus('Could not save your profile. Check your connection and try again.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function finishOnboarding() {
  if (!gateState) return;

  const maxHr = number(document.getElementById('onboarding-max-hr-input')?.value);
  const restingHr = number(
    document.getElementById('onboarding-resting-hr-input')?.value
  );
  const maxHrSource = text(
    document.getElementById('onboarding-max-source-select')?.value
  );

  if (maxHr === null || maxHr < 100 || maxHr > 240) {
    setStatus('Enter a Max HR between 100 and 240.', true);
    return;
  }

  if (restingHr === null || restingHr < 30 || restingHr > 120) {
    setStatus('Enter a Resting HR between 30 and 120.', true);
    return;
  }

  if (maxHr <= restingHr) {
    setStatus('Max HR must be higher than Resting HR.', true);
    return;
  }

  if (!maxHrSource) {
    setStatus('Select how your Max HR was established.', true);
    return;
  }

  const button = document.getElementById('onboarding-finish-btn');
  if (button) button.disabled = true;
  setStatus('Finishing setup...');

  try {
    const currentHR = getStoredHRInfo();
    const nextHR = {
      ...HR_INFO_DEFAULTS,
      ...currentHR,
      maxHr,
      restingHr,
    };

    writeJSON(HR_INFO_STORAGE_KEY, nextHR);
    await saveCloudHRInfo(nextHR);
    await updateMetadata({
      max_hr_source: maxHrSource,
      onboarding_completed_at: new Date().toISOString(),
    });

    gateLocked = false;
    setStatus('Setup complete. Opening Ring Ready...');
    window.setTimeout(() => window.location.reload(), 250);
  } catch (error) {
    console.warn('Required HR setup save failed', error);
    setStatus('Could not finish setup. Check your connection and try again.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

function bindGateEvents() {
  const noFight = document.getElementById('onboarding-no-fight-input');
  const fightDate = document.getElementById('onboarding-fight-date-input');

  noFight?.addEventListener('change', () => {
    if (!fightDate) return;
    fightDate.disabled = noFight.checked;
    if (noFight.checked) fightDate.value = '';
  });

  document
    .getElementById('onboarding-profile-next-btn')
    ?.addEventListener('click', saveProfileStep);
  document
    .getElementById('onboarding-back-btn')
    ?.addEventListener('click', () => setStep('profile'));
  document
    .getElementById('onboarding-finish-btn')
    ?.addEventListener('click', finishOnboarding);
  document
    .getElementById('onboarding-signout-btn')
    ?.addEventListener('click', async () => {
      await signOut();
      window.location.reload();
    });
}

export async function enforceAthleteOnboarding({ showScreen }) {
  if (!isSupabaseConfigured || !getCurrentUser()) return false;

  ensureStyles();
  ensureScreen();
  installNavigationGuard();

  const user = getCurrentUser();
  const metadata = getUserMetadata(user);
  const localProfile = getAthleteProfile();
  const localHR = getStoredHRInfo();

  const [profileResult, hrResult] = await Promise.allSettled([
    loadCloudProfile(),
    loadCloudHRInfo(),
  ]);

  const cloudProfile =
    profileResult.status === 'fulfilled' ? profileResult.value : null;
  const cloudHR = hrResult.status === 'fulfilled' ? hrResult.value : null;

  if (profileResult.status === 'rejected') {
    console.warn('Could not load onboarding profile', profileResult.reason);
  }
  if (hrResult.status === 'rejected') {
    console.warn('Could not load onboarding HR info', hrResult.reason);
  }

  const profile = mergeProfile(localProfile, cloudProfile, metadata);
  const hrInfo = mergeHRInfo(localHR, cloudHR);
  const profileComplete = isProfileComplete(profile, metadata);
  const hrComplete = isHRComplete(hrInfo, cloudHR, metadata);
  const explicitlyComplete = Boolean(metadata.onboarding_completed_at);

  if (profileComplete && hrComplete) {
    saveAthleteProfile(profile);
    writeJSON(HR_INFO_STORAGE_KEY, {
      ...HR_INFO_DEFAULTS,
      ...hrInfo,
    });

    if (!explicitlyComplete) {
      try {
        await updateMetadata({
          onboarding_completed_at: new Date().toISOString(),
          max_hr_source: metadata.max_hr_source || 'Existing saved value',
        });
      } catch (error) {
        console.warn('Could not mark existing athlete onboarding complete', error);
      }
    }

    gateLocked = false;
    return false;
  }

  gateState = {
    user,
    metadata,
    profile,
    hrInfo,
    cloudProfile,
    cloudHR,
  };

  fillGateInputs(gateState);
  bindGateEvents();
  gateLocked = true;
  setStep(profileComplete ? 'hr' : 'profile');
  showScreen(ONBOARDING_SCREEN_ID);
  return true;
}
