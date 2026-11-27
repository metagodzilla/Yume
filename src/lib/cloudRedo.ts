let pending = false;
let phoneNow = false;

export function requestCloudRedo() {
  pending = true;
}

export function consumeCloudRedo(): boolean {
  const value = pending;
  pending = false;
  return value;
}

export function requestPhoneGenerate() {
  phoneNow = true;
}

export function consumePhoneGenerate(): boolean {
  const value = phoneNow;
  phoneNow = false;
  return value;
}
