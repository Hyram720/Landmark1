// The customer must confirm they can use the photo before any portrait is generated.
export const PHOTO_RIGHTS_ERROR = 'Confirm that you own this photo or have the right to use it.';

export function photoRightsAccepted(value) {
  return value === true || value === 'true' || value === 'on' || value === 'yes' || value === '1';
}

export function photoRightsTimestamp(body, now = new Date()) {
  const value = body?.photoRights ?? body?.photo_rights;
  if (!photoRightsAccepted(value)) {
    const err = new Error(PHOTO_RIGHTS_ERROR);
    err.status = 400;
    throw err;
  }
  return now.toISOString();
}

export function assertPhotoRights(order) {
  if (!order?.photoRightsAt || Number.isNaN(Date.parse(order.photoRightsAt))) {
    const err = new Error('Photo rights were not confirmed. Generation did not run.');
    err.code = 'PHOTO_RIGHTS_REQUIRED';
    throw err;
  }
}
