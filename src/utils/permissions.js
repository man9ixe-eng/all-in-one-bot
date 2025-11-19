// src/utils/permissions.js

const roles = require('../config/roles');

/**
 * Check if a member has any of the given role IDs.
 * @param {import('discord.js').GuildMember} member
 * @param {string[]} roleIds
 */
function hasAnyRole(member, roleIds = []) {
  if (!member || !member.roles) return false;
  return member.roles.cache.some(role => roleIds.includes(role.id));
}

/**
 * Returns a tier number for this member:
 * 1 = regular member (no staff roles)
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
 * Check if member's tier is >= requiredTier.
 * Example: atLeastTier(member, 4) → true for T4–T7
 */
function atLeastTier(member, requiredTier) {
  const tier = getTier(member);
  return tier >= requiredTier;
}

// Convenience helpers if you ever want them
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
  atLeastTier,
  isRegular,
  isJuniorStaff,
  isIntern,
  isManagement,
  isSeniorManagement,
  isCorporate,
  isPresidential,
};
