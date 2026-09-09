import type { heatLayer } from '../layers/heat.js';

let factory: typeof heatLayer | undefined;
let pending: Promise<typeof heatLayer> | undefined;

export function currentHeatFactory(): typeof heatLayer | undefined { return factory; }

/** Shared by all managers; a failed download may be retried by a later render. */
export function loadHeatFactory(): Promise<typeof heatLayer> {
  return pending ??= import('../layers/heat.js').then(module => {
    factory = module.heatLayer;
    return factory;
  }).catch(error => {
    pending = undefined;
    throw error;
  });
}
