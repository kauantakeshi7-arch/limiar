import { Random } from '../utils/Random.js';

/**
 * DNA — The genetic blueprint of a creature.
 *
 * Every gene is a float in [0, 1] where 0 and 1 are the two extremes.
 * Genes influence behavior, transformation, and aesthetics.
 */
export class DNA {
  /**
   * @param {object} genes
   * @param {number} genes.resistance   - Survival time in foreign zone (0=fragile, 1=resilient)
   * @param {number} genes.memory       - Speed bonus on repeated crossings
   * @param {number} genes.dominance    - Combat effectiveness in interactions
   * @param {number} genes.adaptation   - Speed of visual/behavioral transformation
   * @param {number} genes.echo         - Influence radius on nearby creatures
   * @param {number} genes.luminosity   - Base brightness (aesthetic)
   * @param {number} genes.rhythm       - Speed of the blob breathing animation
   */
  constructor({
    resistance  = 0.5,
    memory      = 0.5,
    dominance   = 0.5,
    adaptation  = 0.5,
    echo        = 0.5,
    luminosity  = 0.5,
    rhythm      = 0.5,
  } = {}) {
    this.resistance  = Math.max(0, Math.min(1, resistance));
    this.memory      = Math.max(0, Math.min(1, memory));
    this.dominance   = Math.max(0, Math.min(1, dominance));
    this.adaptation  = Math.max(0, Math.min(1, adaptation));
    this.echo        = Math.max(0, Math.min(1, echo));
    this.luminosity  = Math.max(0, Math.min(1, luminosity));
    this.rhythm      = Math.max(0, Math.min(1, rhythm));
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  /** Transform duration in ms. High resistance → longer survival before dissolving. */
  get transformDurationMs() {
    return 6000 + this.resistance * 10000;
  }

  /** How quickly the creature visually morphs. High adaptation → faster. */
  get morphSpeed() {
    return 0.3 + this.adaptation * 0.7;
  }

  /** Creature's effective radius offset from base. Larger dominance → slightly bigger. */
  get sizeModifier() {
    return 0.8 + this.dominance * 0.5;
  }

  /** Breathing oscillation speed. */
  get breatheSpeed() {
    return 0.0005 + this.rhythm * 0.0012;
  }

  // ── Genetics operations ───────────────────────────────────────────────────

  /**
   * Create an offspring DNA by crossing two parents with optional mutation.
   * @param {DNA} parentA
   * @param {DNA} parentB
   * @param {number} [mutationRate=0.1] - Probability of mutation per gene.
   * @param {number} [mutationStrength=0.2] - Max delta applied by a mutation.
   */
  static crossover(parentA, parentB, mutationRate = 0.1, mutationStrength = 0.2) {
    const genes = {};
    for (const key of DNA._GENE_KEYS) {
      const t = Random.next(); // random mix ratio
      genes[key] = parentA[key] * t + parentB[key] * (1 - t);

      if (Random.chance(mutationRate)) {
        genes[key] += Random.float(-mutationStrength, mutationStrength);
      }
    }
    return new DNA(genes);
  }

  /**
   * Mutate this DNA by a given strength and return a new DNA.
   * @param {number} [strength=0.15]
   */
  mutate(strength = 0.15) {
    const genes = {};
    for (const key of DNA._GENE_KEYS) {
      genes[key] = this[key] + Random.float(-strength, strength);
    }
    return new DNA(genes);
  }

  clone() {
    return new DNA({ ...this });
  }

  /** Generate a random DNA instance. */
  static random() {
    const genes = {};
    for (const key of DNA._GENE_KEYS) {
      genes[key] = Random.next();
    }
    return new DNA(genes);
  }

  /** Gene keys for iteration. */
  static _GENE_KEYS = ['resistance', 'memory', 'dominance', 'adaptation', 'echo', 'luminosity', 'rhythm'];

  toString() {
    return `DNA(res:${this.resistance.toFixed(2)} mem:${this.memory.toFixed(2)} dom:${this.dominance.toFixed(2)})`;
  }
}
