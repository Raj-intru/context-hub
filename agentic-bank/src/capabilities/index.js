import { createRegistry } from './registry.js';
import { registerSharedCapabilities } from './shared.js';
import { registerConsumerCapabilities } from './consumer.js';
import { registerBusinessCapabilities } from './business.js';
import { registerInstitutionalCapabilities } from './institutional.js';

/**
 * The bank's product surface.
 *
 * One registry serves all three segments. Which capabilities a given customer
 * can see is decided by their segment; which they can *use* is decided by their
 * mandates. Those are two different questions and this build keeps them apart.
 */
export function buildRegistry() {
  const registry = createRegistry();
  registerSharedCapabilities(registry);
  registerConsumerCapabilities(registry);
  registerBusinessCapabilities(registry);
  registerInstitutionalCapabilities(registry);
  return registry;
}

export { createRegistry, toolName } from './registry.js';
