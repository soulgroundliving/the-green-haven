/**
 * Owner Info Helpers
 * Extracted to external file to avoid const declaration conflicts in tenant.html
 */

function getOwnerInfoData() {
  return typeof OwnerConfigManager !== 'undefined' ? OwnerConfigManager.getOwnerInfo() : {};
}

function getOwnerName() {
  return getOwnerInfoData()?.name || 'The Green Haven Co., Ltd.';
}

function getBuildingDisplayName() {
  return typeof currentBuilding !== 'undefined' && currentBuilding === 'nest' ? 'Nest' : 'ห้องเช่า';
}
