/**
 * What the logged-in user may do, from the login response:
 *   capabilities      — workflow responsibilities (backend lib/roles.js)
 *   permitted_modules — menu modules (null = everything)
 * Sessions from before these fields existed get the old behaviour (allowed);
 * the server enforces it either way.
 */
export const canDo = (user, capability) => !Array.isArray(user?.capabilities) || user.capabilities.includes(capability);
export const hasModule = (user, key) => !Array.isArray(user?.permitted_modules) || user.permitted_modules.includes(key);
