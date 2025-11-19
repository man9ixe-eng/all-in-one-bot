// src/utils/permissions.js

const roles = require('../config/roles');

/**
 * Check if a member has any of the given role IDs.
 * @param {import('discord.js').GuildMember} member
 * @param {string[]} roleIds
 */
function hasAnyRole(member, roleIds = []) {
  if (!member) return false;

  // Normalize configured IDs to strings
  const configured = new Set((roleIds || []).map(id => String(id)));

  let memberRoleIds = [];

  // Case 1: Normal GuildMember with roles cache
  if (member.roles && member.roles.cache) {
    memberRoleIds = Array.from(member.roles.cache.keys());
  }
  // Case 2: API-style member where roles is an array of IDs
  else if (member.roles && Array.isArray(member.roles)) {
    memberRoleIds = member.roles.map(String);
  }

  if (memberRoleIds.length === 0) return false;

  return memberRoleIds.some(id => configured.has(String(id)));
}

/**
 * Returns a tier number for this member:
 * 1 = Regular member (no staff roles)
 * 2 = Junior Staff
 * 3 = Intern
 * 4 = Management
 * 5 = Senior Management
 * 6 = Corporate
 * 7 = Presidential / Owner
 */
function getTier(member) {
  if (!member || !member.guild) return 1; // default to regular

  let tier = 1; // regular

  if (hasAnyRole(member, roles.JUNIOR_STAFF_ROLE_IDS || [])) {
    tier = Math.max(tier, 2);
  }
  if (hasAnyRole(member, roles.INTERN_ROLE_IDS || [])) {
    tier = Math.max(tier, 3);
  }
  if (hasAnyRole(member, roles.MANAGEMENT_ROLE_IDS || [])) {
    tier = Math.max(tier, 4);
  }
  if (hasAnyRole(member, roles.SENIOR_MANAGEMENT_ROLE_IDS || [])) {
    tier = Math.max(tier, 5);
  }
  if (hasAnyRole(member, roles.CORPORATE_ROLE_IDS || [])) {
    tier = Math.max(tier, 6);
  }
  if (hasAnyRole(member, roles.PRESIDENTIAL_ROLE_IDS || [])) {
    tier = Math.max(tier, 7);
  }

  // Guild owner / OWNER_IDS always treated as Tier 7
  if (member.id === member.guild.ownerId) {
    tier = 7;
  }
  if (Array.isArray(roles.OWNER_IDS) && roles.OWNER_IDS.includes(member.id)) {
    tier = 7;
  }

  return tier;
}

/**
 * Human-readable label for a tier number.
 */
function getTierLabel(tier) {
  switch (tier) {
    case 1: return 'Regular Member';
    case 2: return 'Junior Staff';
    case 3: return 'Intern';
    case 4: return 'Management';
    case 5: return 'Senior Management';
    case 6: return 'Corporate';
    case 7: return 'Presidential / Owner';
    default: return `Unknown (Tier ${tier})`;
  }
}

/**
 * Check if member's tier is >= requiredTier.
 * Example: atLeastTier(member, 4) → true for T4–T7
 */
function atLeastTier(member, requiredTier) {
  const tier = getTier(member);
  return tier >= requiredTier;
}

// Convenience helpers (optional)
function isRegular(member)      { return getTier(member) === 1; }
function isJuniorStaff(member)  { return getTier(member) === 2; }
function isIntern(member)       { return getTier(member) === 3; }
function isManagement(member)   { return getTier(member) === 4; }
function isSeniorManagement(m)  { return getTier(m) === 5; }
function isCorporate(member)    { return getTier(member) === 6; }
function isPresidential(member) { return getTier(member) === 7; }

module.exports = {
  hasAnyRole,
  getTier,
  getTierLabel,
  atLeastTier,
  isRegular,
  isJuniorStaff,
  isIntern,
  isManagement,
  isSeniorManagement,
  isCorporate,
  isPresidential,
};
