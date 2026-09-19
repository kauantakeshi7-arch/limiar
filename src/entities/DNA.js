import { Config } from '../core/Config.js';
import { Random } from '../utils/Random.js';

/**
 * DNA — The genetic blueprint of a creature.
 *
 * Every gene is a float in [0, 1] where 0 and 1 are the two extremes.
 * Genes influence morphology (bodyPlan, segments, tentacles), behavior (curiosity, caution),
 * transformation, and aesthetics.
 */
export class DNA {
  /**
   * @param {object} genes
   * @param {number} genes.resistance   - Survival time in foreign zone (0=fragile, 1=resilient)
   * @param {number} genes.memory       - Speed bonus on repeated crossings & emotional memory
   * @param {number} genes.dominance    - Combat effectiveness in interactions
   * @param {number} genes.adaptation   - Speed of visual/behavioral transformation
   * @param {number} genes.echo         - Influence radius on nearby creatures
   * @param {number} genes.luminosity   - Base brightness (aesthetic)
   * @param {number} genes.rhythm       - Speed of the blob breathing animation
   * @param {number} genes.bodyPlan     - Morphological archetype [0..1]
   * @param {number} genes.segments     - Node count for segmented/articulated forms
   * @param {number} genes.tentacles    - Appendage/tail count
   * @param {number} genes.flutter      - Wing/fin flutter frequency
   * @param {number} genes.curiosity    - Inclination to follow ripples & player gestures
   * @param {number} genes.caution      - Fearfulness and avoidance of perceived threats
   */
  constructor({
    resistance  = 0.5,
    memory      = 0.5,
    dominance   = 0.5,
    adaptation  = 0.5,
    echo        = 0.5,
    luminosity  = 0.5,
    rhythm      = 0.5,
    bodyPlan    = 0.1,
    segments    = 0.5,
    tentacles   = 0.5,
    flutter     = 0.5,
    curiosity   = 0.5,
    caution     = 0.5,
    legendaryTrait = null,
  } = {}) {
    this.resistance  = Math.max(0, Math.min(1, resistance));
    this.memory      = Math.max(0, Math.min(1, memory));
    this.dominance   = Math.max(0, Math.min(1, dominance));
    this.adaptation  = Math.max(0, Math.min(1, adaptation));
    this.echo        = Math.max(0, Math.min(1, echo));
    this.luminosity  = Math.max(0, Math.min(1, luminosity));
    this.rhythm      = Math.max(0, Math.min(1, rhythm));
    this.bodyPlan    = Math.max(0, Math.min(1, bodyPlan));
    this.segments    = Math.max(0, Math.min(1, segments));
    this.tentacles   = Math.max(0, Math.min(1, tentacles));
    this.flutter     = Math.max(0, Math.min(1, flutter));
    this.curiosity   = Math.max(0, Math.min(1, curiosity));
    this.caution     = Math.max(0, Math.min(1, caution));
    this.legendaryTrait = legendaryTrait;
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

  /** Morphological body plan determined by the bodyPlan gene. */
  get bodyPlanType() {
    if (this.bodyPlan < 0.20) return Config.BODY_PLAN.BLOB;
    if (this.bodyPlan < 0.40) return Config.BODY_PLAN.MANTA;
    if (this.bodyPlan < 0.60) return Config.BODY_PLAN.JELLYFISH;
    if (this.bodyPlan < 0.80) return Config.BODY_PLAN.SERPENTINE;
    return Config.BODY_PLAN.CRYSTAL;
  }

  /** Number of articulated vertebrae or node segments. */
  get segmentCount() {
    return Math.floor(2 + this.segments * 4); // 2 to 6
  }

  /** Number of tentacles or trailing filaments. */
  get tentacleCount() {
    return Math.floor(2 + this.tentacles * 3); // 2 to 5
  }

  /** Wing or fin flutter oscillation rate. */
  get flutterRate() {
    return 0.0025 + this.flutter * 0.0045;
  }

  // ── Genetics operations ───────────────────────────────────────────────────

  /**
   * Create an offspring DNA by crossing two parents with optional mutation.
   * @param {DNA} parentA
   * @param {DNA} parentB
   * @param {number} [mutationRate=0.12] - Probability of mutation per gene.
   * @param {number} [mutationStrength=0.18] - Max delta applied by a mutation.
   */
  static crossover(parentA, parentB, mutationRate = 0.12, mutationStrength = 0.18) {
    const genes = {};
    for (const key of DNA._GENE_KEYS) {
      const t = Random.next(); // random mix ratio
      genes[key] = parentA[key] * t + parentB[key] * (1 - t);

      if (Random.chance(mutationRate)) {
        genes[key] += Random.float(-mutationStrength, mutationStrength);
      }
    }

    // Legendary Trait inheritance or spontaneous mythical awakening
    let trait = null;
    if (parentA.legendaryTrait && Random.chance(0.48)) {
      trait = parentA.legendaryTrait;
    } else if (parentB.legendaryTrait && Random.chance(0.48)) {
      trait = parentB.legendaryTrait;
    } else if (Random.chance(Config.LEGENDARY?.MUTATION_CHANCE_BASE || 0.035)) {
      const allTraits = Object.values(Config.LEGENDARY?.TRAITS || {});
      if (allTraits.length > 0) {
        trait = allTraits[Math.floor(Math.random() * allTraits.length)];
      }
    }
    genes.legendaryTrait = trait;

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

  /** Gene keys for iteration and inheritance. */
  static _GENE_KEYS = [
    'resistance', 'memory', 'dominance', 'adaptation', 'echo', 'luminosity', 'rhythm',
    'bodyPlan', 'segments', 'tentacles', 'flutter', 'curiosity', 'caution'
  ];

  toString() {
    return `DNA(plan:${this.bodyPlanType} res:${this.resistance.toFixed(2)} cur:${this.curiosity.toFixed(2)})`;
  }
}
