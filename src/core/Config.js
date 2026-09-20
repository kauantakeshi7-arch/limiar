/**
 * Config — Single source of truth for all game constants.
 * Frozen to prevent accidental mutation at runtime.
 */
export const Config = Object.freeze({

  // ── World ──────────────────────────────────────────────────────────────────
  WORLD: Object.freeze({
    INITIAL_CREATURES_PER_ZONE: 4,
    MAX_CREATURES: 16,
    MAX_CREATURES_PER_ZONE: 8,
    /** Initial threshold position as a ratio of canvas height (0 = top). */
    THRESHOLD_INITIAL_RATIO: 0.5,
    /** Drag resistance: lower = heavier feel. */
    THRESHOLD_RESISTANCE: 0.08,
    /** Spring-back force when releasing threshold. */
    THRESHOLD_SPRING: 0.04,
    /** Thickness of the threshold zone (px) where creatures can become HYBRID. */
    THRESHOLD_BAND: 20,
  }),

  // ── Zones ──────────────────────────────────────────────────────────────────
  ZONE: Object.freeze({
    LIGHT: 'light',
    SHADOW: 'shadow',
    THRESHOLD: 'threshold',
  }),

  // ── Creatures ─────────────────────────────────────────────────────────────
  CREATURE: Object.freeze({
    BASE_RADIUS: 15,
    MIN_RADIUS: 8,
    MAX_RADIUS: 34,
    BASE_SPEED: 0.40, // Gentle, serene cruising speed (prevents frantic darting)
    MAX_SPEED: 1.20,  // Soft ceiling to guarantee peace and fluidity
    /** Number of blob anchor points around the creature. */
    BLOB_POINTS: 10,
    BLOB_NOISE_AMPLITUDE: 0.30,
    BLOB_BREATHE_SPEED: 0.0007,
    /** Unique syllable-based names (prefix + suffix). */
    NAME_PREFIXES: ['Vel', 'Aes', 'Kro', 'Lim', 'Ner', 'Oth', 'Vex', 'Zar', 'Ium', 'Sol'],
    NAME_SUFFIXES: ['-orn', '-ix', '-ara', '-oth', '-en', '-ius', '-ael', '-vel', '-um', '-as'],
  }),

  // ── Steering (Craig Reynolds) ─────────────────────────────────────────────
  STEERING: Object.freeze({
    WANDER_RADIUS: 50,
    WANDER_DISTANCE: 80,
    WANDER_JITTER: 0.20,
    SEPARATION_RADIUS: 40,
    SEPARATION_FORCE: 1.1,
    ZONE_ATTRACTION_FORCE: 0.12,
    THRESHOLD_AVOID_FORCE: 0.32,
  }),

  // ── Evolution & Transformation ────────────────────────────────────────────
  EVOLUTION: Object.freeze({
    /** Base time (ms) for full transformation in foreign zone. */
    TRANSFORM_BASE_MS: 9000,
    /** Base time (ms) before a crossing creature starts dissolving. */
    DISSOLVE_DELAY_MS: 14000,
    /** Probability to become HYBRID instead of TRANSFORMED (per transformation). */
    HYBRID_CHANCE: 0.12,
    /** Probability to TRANSCEND instead of DISSOLVE (per creature, per check). */
    TRANSCENDENCE_CHANCE: 0.05,
    /** How many times a creature must have crossed to gain the memory bonus. */
    MEMORY_THRESHOLD: 1,
    MEMORY_SPEED_BONUS: 1.4,
  }),

  // ── Interactions ──────────────────────────────────────────────────────────
  INTERACTION: Object.freeze({
    RADIUS: 55,
    /** Min size ratio between two creatures for absorption to occur. */
    ABSORPTION_RATIO: 1.65,
    SYMBIOSIS_CHANCE: 0.07,
    EXPLOSION_CHANCE: 0.25,
    /** Spawn count from an explosion. */
    EXPLOSION_SPAWN_COUNT: 2,
    /** Cooldown (ms) between interactions for the same creature pair. */
    COOLDOWN_MS: 3000,
  }),

  // ── Rare Events ───────────────────────────────────────────────────────────
  RARE: Object.freeze({
    /** Probability per frame of an eclipse starting. */
    ECLIPSE_CHANCE: 0.00035,
    ECLIPSE_DURATION_MS: 28000,
    SINGULARITY_CHANCE: 0.00025,
    SINGULARITY_DURATION_MS: 9000,
    WITNESS_CHANCE: 0.0006,
    WITNESS_DURATION_MS: 4000,
    /** Creatures needed to trigger a chain crossing event. */
    CHAIN_MIN_COUNT: 5,
  }),

  // ── Spawning ──────────────────────────────────────────────────────────────
  SPAWN: Object.freeze({
    INTERVAL_MS: 6000,
    /** Creatures spawned per interval (one per zone). */
    COUNT_PER_ZONE: 1,
  }),

  // ── Particles ─────────────────────────────────────────────────────────────
  PARTICLES: Object.freeze({
    POOL_SIZE: 400,
    TRANSFORM_BURST: 12,
    DISSOLVE_BURST: 18,
    TRANSCEND_BURST: 30,
    THRESHOLD_AMBIENT: 3,
    LIFESPAN_MS: 1800,
  }),

  // ── Diary ─────────────────────────────────────────────────────────────────
  DIARY: Object.freeze({
    MAX_ENTRIES: 80,
  }),

  // ── Living Ecosystem & Poetic Interactions ────────────────────────────────
  ECOSYSTEM: Object.freeze({
    // Global Diurnal Breathing Tide
    DIURNAL_PERIOD_MS: 100_000, // 100s full diurnal tide

    // Sleep & Dreams
    SLEEP_IDLE_MS: 24_000,      // time undisturbed before entering peaceful sleep
    SLEEP_WAKE_DIST: 65,        // proximity to wake a sleeping creature
    DREAM_INTERVAL_MS: 900,     // emission rate of dream motes while asleep

    // Border Courtship Dance (Dança dos Opostos)
    DANCE_DURATION_MS: 5_500,
    DANCE_RADIUS: 65,
    DANCE_MIN_AFFINITY: 0.45,

    // Nectar Gifting
    NECTAR_HOLD_MS: 600,        // finger hold duration to condense celestial nectar
    NECTAR_ATTRACT_DIST: 240,   // detection radius for creatures
    NECTAR_DURATION_MS: 10_000, // how long nectar persists if not fully eaten

    // Threshold Living Flora
    FLORA_COUNT: 24,            // reeds along the threshold membrane
    FLORA_HEIGHT: 48,
    FLORA_SPORE_CHANCE: 0.012,

    // Harp Frequencies (Pentatonic D Major / Zen: D3, E3, G3, A3, B3, D4, E4, G4, A4, B4, D5)
    HARP_NOTES: Object.freeze([
      146.83, 164.81, 196.00, 220.00, 246.94,
      293.66, 329.63, 392.00, 440.00, 493.88, 587.33,
    ]),
  }),

  // ── Morphological Body Plans ──────────────────────────────────────────────
  BODY_PLAN: Object.freeze({
    BLOB:       'blob',       // Ancestral fluid amoeba
    MANTA:      'manta',      // Winged ray gliding on currents
    JELLYFISH:  'jellyfish',  // Pulsing bell with trailing articulated tentacles
    SERPENTINE: 'serpentine', // Multi-segment chained body
    CRYSTAL:    'crystal',    // Faceted geometric polyhedron with prism spines
    PHOENIX:    'phoenix',    // Astral soaring firebird with plasma plumage
    NAUTILUS:   'nautilus',   // Golden spiral shell with hydrodynamic siphon
  }),

  // ── Artificial Intelligence & Drives ──────────────────────────────────────
  AI: Object.freeze({
    DECISION_INTERVAL_MS: 340,  // Staggered, calm decision cadence (was 160)
    VISION_RANGE: 155,          // Harmonious sensory radius (was 190)
    VISION_CONE_RAD: Math.PI * 0.70, // ~126 degrees forward cone
    DRIVE_DECAY_RATE: 0.00005,
    HUNGER_RATE: 0.00006,       // Serene hunger depletion
    FATIGUE_RATE: 0.00003,      // Gentle fatigue
    MEMORY_RETENTION: 0.9992,   // Long-lasting emotional memory
  }),

  // ── Legendary Phenotypes & Mythical Mutations ─────────────────────────────
  LEGENDARY: Object.freeze({
    MUTATION_CHANCE_BASE: 0.035, // 3.5% base chance on offspring crossover
    TRAITS: Object.freeze({
      TWIN_WINGS:     'twin_wings',     // Manta with secondary etheric wings
      STELLAR_HALO:   'stellar_halo',   // Orbiting celestial halo particles
      ABYSSAL_VEINS:  'abyssal_veins',  // Night-glowing fluorescent vascular veins
      PRISM_TAIL:     'prism_tail',     // Rainbow spectral chromatic refraction
    }),
  }),

  // ── Player Interaction & Call & Response ──────────────────────────────────
  INTERACTION_EXPANDED: Object.freeze({
    CALL_HOLD_MS: 380,          // Hold duration in empty space to emit melodic call
    CALL_RADIUS: 260,           // Soundwave propagation radius
    FLORA_BRUSH_RADIUS: 42,     // Distance to brush and deflect flora reeds
    SPORE_NUTRITION: 0.28,      // Energy given by eating a living spore
    SPORE_LIFESPAN_MS: 12000,   // How long released spores drift before fading
  }),

  // ── Persistence ───────────────────────────────────────────────────────────
  STORAGE: Object.freeze({
    KEY_BESTIARY: 'limiar_bestiary_v1',
    BESTIARY_KEY: 'limiar_bestiary_v1',
    KEY_DIARY:    'limiar_diary_v1',
    DIARY_KEY:    'limiar_diary_v1',
    KEY_STATS:    'limiar_stats_v1',
    KEY_SETTINGS: 'limiar_settings_v1',
  }),

  // ── Mobile Haptics ────────────────────────────────────────────────────────
  HAPTICS: Object.freeze({
    PLUCK: 12,              // ms light tap when string plucks
    BRUSH: 8,               // ms tick when flora brushes
    CALL: 22,               // ms gentle buzz when singing call
    BIRTH: 35,              // ms triumphant pulse on creature birth
    SNAP: 18,               // ms click on photo snapshot
    INSPECT_POP_MS: 22,
    TAP_LIGHT_MS: 8,
    CALL_HARMONY_MS: 28,
    NECTAR_CONDENSE_MS: 40,
    SNAP_CAPTURE_MS: 35,
  }),

  // ── Zen Bioluminescence & Quorum Sensing ──────────────────────────────────
  BIOLUMINESCENCE: Object.freeze({
    WAVE_RADIUS: 120,            // Sensory radius for light communication
    PROPAGATION_FACTOR: 0.44,    // Damped energy per hop (1.0 -> 0.44 -> 0.19 -> 0)
    MAX_GENERATIONS: 2,          // Extinguishes softly after 2 hops to prevent visual noise
    COOLDOWN_MS: 4500,           // Individual cooldown before creature can echo light again
    PULSE_DURATION_MS: 1200,     // Gentle sine envelope duration
    MIN_INTENSITY_TRIGGER: 0.20, // Threshold to trigger neighbor echoes
  }),

  // ── Ontogeny & Life Stages ────────────────────────────────────────────────
  LIFE_STAGE: Object.freeze({
    JUVENILE:  'juvenile',   // 0 to 35s: smaller (0.50 -> 1.0), translucent, agile
    ADULT:     'adult',      // 35s to 120s: full morphology & reproductive readiness
    ANCESTRAL: 'ancestral',  // > 120s: orbital star crown, long trails (24pts), luminous halo
  }),

  ONTOGENY: Object.freeze({
    JUVENILE_DURATION_MS: 35_000,
    ANCESTRAL_AGE_MS: 120_000,
    JUVENILE_SCALE_MIN: 0.50,
    JUVENILE_ALPHA_MIN: 0.42,
    ANCESTRAL_TRAIL_LENGTH: 24,
    ANCESTRAL_STARS_COUNT: 4,
  }),

  // ── Sanctuaries & Micro-Climates ──────────────────────────────────────────
  SANCTUARIES: Object.freeze({
    REEF_COUNT: 3,                 // 2 in Shadow abyss, 1 in Solar light
    POLYP_COUNT_PER_REEF: 5,       // Organic stalks per cluster
    SPORE_INTERVAL_MS: 3800,       // Interval between gentle spore emissions
    REST_ATTRACT_RADIUS: 140,      // Creatures drawn to rest near reefs
    REST_ENERGY_REGEN: 0.00018,    // Energy/vitality recovery per ms when resting
    GROWTH_BONUS_SPORE: 0.08,      // Nutrient growth boost for juveniles
  }),

  // ── Periodic Cosmic Tides ─────────────────────────────────────────────────
  TIDES: Object.freeze({
    INTERVAL_MS: 50_000,           // Calm tide interval (~50s between tides)
    DURATION_MS: 12_000,           // Tide transit duration (~12s)
    FORCE: 0.42,                   // Gentle lateral acceleration
  }),

  // ── Cosmic Seasons (Biomas Temporais) ─────────────────────────────────────
  SEASONS: Object.freeze({
    SEASON_DURATION_MS: 240_000,    // 4 minutes per cosmic season
    TRANSITION_DURATION_MS: 32_000, // 32s smooth cosine crossfade between seasons
    TYPES: Object.freeze({
      CRYSTAL_TIDE:   'crystal_tide',   // High translucency, quartz motes, featherweight glide
      BOREAL_NIGHT:   'boreal_night',   // Emerald/cyan bioluminescence & quorum sensing harmonic waves
      GOLDEN_ECLIPSE: 'golden_eclipse', // Warm cozy sunset amber light & celestial peacefulness
    }),
    NAMES: Object.freeze({
      crystal_tide:   'Maré de Cristal',
      boreal_night:   'Noite Boreal',
      golden_eclipse: 'Eclipse Dourado',
    }),
  }),

  // ── Hydrothermal Fissures & Abyssal Vents ─────────────────────────────────
  HYDROTHERMAL_VENTS: Object.freeze({
    COUNT: 3,                       // 3 abyssal vents along the deep floor
    MIN_Y_RATIO: 0.85,              // Deep shadow realm stratum
    BUBBLE_INTERVAL_MS: 3400,       // Interval between slow rising concentric bubble rings
    UPDRAFT_FORCE: 0.24,            // Gentle thermal convection acceleration
    UPDRAFT_RADIUS: 95,             // Width of rising thermal column
    REST_ENERGY_REGEN: 0.00022,     // Thermal soothing warmth recovery rate
    ATTRACT_ANCESTRAL_RADIUS: 180,  // Large & ancient creatures drawn to thermal vents
  }),

  // ── Aurora Nursery (Estrato Celeste Supremo) ──────────────────────────────
  AURORA_NURSERY: Object.freeze({
    HEIGHT_RATIO: 0.20,             // Top 20% of the canvas
    JUVENILE_BUOYANCY: 0.18,        // Mild upward buoyancy drawing younglings to nursery
    MICROGRAVITY_DAMPING: 0.72,     // Featherweight floating sensation
    SHIMMER_DURATION_MS: 12_000,    // Duration of silver stardust trail
    SHIMMER_TRAIL_RATE: 120,        // ms between stardust particle spawns
    GROWTH_BOOST: 0.00015,          // Growth acceleration while floating in the aurora
  }),

});

