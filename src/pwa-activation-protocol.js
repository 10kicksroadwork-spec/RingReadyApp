export const SW_ACTIVATION_PROTOCOL = 2;
export const SW_SKIP_WAITING_MESSAGE_TYPE = 'RINGREADY_SKIP_WAITING';

export function buildSkipWaitingMessage() {
  return {
    type: SW_SKIP_WAITING_MESSAGE_TYPE,
    protocol: SW_ACTIVATION_PROTOCOL,
  };
}

export function isCurrentSkipWaitingMessage(data) {
  return data?.type === SW_SKIP_WAITING_MESSAGE_TYPE
    && data?.protocol === SW_ACTIVATION_PROTOCOL;
}
