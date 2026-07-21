export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HR_CHAR = '00002a37-0000-1000-8000-00805f9b34fb';
export const HR_SERVICE_NUM = 0x180d;
export const HR_CHAR_NUM = 0x2a37;

export function parseHeartRateMeasurement(dataView) {
  const flags = dataView.getUint8(0);
  const is16Bit = flags & 0x01;
  const hr = is16Bit ? dataView.getUint16(1, true) : dataView.getUint8(1);

  if (!hr || hr < 30 || hr > 240) return null;

  return hr;
}

export function createHRBuffer(maxItems = 5, staleMs = 10000) {
  let readings = [];

  return {
    push(hr) {
      readings.push({ hr, at: Date.now() });
      if (readings.length > maxItems) readings.shift();
    },

    avgFresh() {
      const now = Date.now();
      const fresh = readings.filter((r) => now - r.at <= staleMs);
      if (!fresh.length) return null;
      return Math.round(fresh.reduce((sum, r) => sum + r.hr, 0) / fresh.length);
    },

    latestFresh() {
      const last = readings[readings.length - 1];
      if (!last) return null;
      if (Date.now() - last.at > staleMs) return null;
      return last.hr;
    },

    lastAt() {
      const last = readings[readings.length - 1];
      return last ? last.at : null;
    },

    clear() {
      readings = [];
    },
  };
}
