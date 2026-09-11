import type { ToolDefinition } from '../../shared/types.js'

/** learning tool definitions. */
export const learningTools: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'clear_lessons',
      description: `Remove lessons from memory. Use when the user asks to erase lessons, or when lessons contain bad data (e.g. bug-caused -100% PnL records).

Modes:
- keyword: remove all lessons whose text contains the keyword (e.g. "-100%", "FAILED", "WhiteHouse")
- all: wipe every lesson
- performance: wipe all closed position performance records (the raw data lessons are derived from)`,
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['keyword', 'all', 'performance'],
            description: 'What to clear',
          },
          keyword: {
            type: 'string',
            description: 'Required when mode=keyword. Case-insensitive substring match against lesson text.',
          },
        },
        required: ['mode'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'set_position_note',
      description: `Save a persistent instruction for a position that ALL future management cycles will respect.
Use this immediately whenever the user gives a specific instruction about a position:
- "hold until 5% profit"
- "don't close before fees hit $10"
- "close if it goes out of range"
- "hold for at least 2 hours"

The instruction is stored in state.json and injected into every management cycle prompt.
Pass null or empty string to clear an existing instruction.`,
      parameters: {
        type: 'object',
        properties: {
          position_address: {
            type: 'string',
            description: 'The position address to attach the instruction to',
          },
          instruction: {
            type: 'string',
            description: "The instruction to persist (e.g. 'hold until PnL >= 5%'). Pass empty string to clear.",
          },
        },
        required: ['position_address', 'instruction'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'add_lesson',
      description: `Save a lesson to the agent's permanent memory.
Use after studying top LPers or observing a pattern worth remembering.
Lessons are injected into the system prompt on every future cycle.
Write concrete, actionable rules — not vague observations.

Use 'role' to target a specific agent type so it only appears in the right context.
Use 'pinned: true' for critical rules that must always be present regardless of memory cap.

Examples:
- rule: "PREFER: pools where top LPers hold < 30 min", tags: ["scalping"], role: "SCREENER"
- rule: "AVOID: closing when OOR < 30min — price often recovers", tags: ["oor"], role: "MANAGER", pinned: true`,
      parameters: {
        type: 'object',
        properties: {
          rule: {
            type: 'string',
            description: 'The lesson rule — specific and actionable',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: "Tags e.g. ['narrative', 'screening', 'oor', 'fees', 'management']",
          },
          role: {
            type: 'string',
            enum: ['SCREENER', 'MANAGER', 'GENERAL'],
            description: 'Which agent role this lesson applies to. Omit for all roles.',
          },
          pinned: {
            type: 'boolean',
            description: "Pin this lesson so it's always injected regardless of memory cap. Use for critical rules.",
          },
        },
        required: ['rule'],
      },
    },
  },

  // ─── Strategy Library ──────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'add_strategy',
      description: `Save a new LP strategy to the strategy library.
Use when the user pastes a tweet or description of a strategy.
Parse the text and extract structured criteria, then call this tool to store it.
The strategy will be available for selection before future deployments.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: "Short slug e.g. 'overnight_classic_bid_ask', 'panda_strat'" },
          name: { type: 'string', description: 'Human-readable name' },
          author: { type: 'string', description: 'Strategy author/creator' },
          lpStrategy: { type: 'string', enum: ['bid_ask', 'spot', 'curve'], description: 'LP strategy type' },
          tokenCriteria: {
            type: 'object',
            description: 'Token selection criteria',
            properties: {
              min_mcap: { type: 'number', description: 'Minimum market cap in USD' },
              min_age_days: { type: 'number', description: 'Minimum token age in days' },
              requires_kol: { type: 'boolean', description: 'Requires KOL presence' },
              notes: { type: 'string', description: 'Additional token selection notes' },
            },
          },
          entry: {
            type: 'object',
            description: 'Entry conditions',
            properties: {
              condition: { type: 'string', description: 'Entry condition description' },
              price_change_threshold_pct: {
                type: 'number',
                description: 'Price change % that triggers entry (e.g. -30 for -30% from ATH)',
              },
              singleSide: { type: 'string', description: 'sol or token' },
            },
          },
          range: {
            type: 'object',
            description: 'Bin range configuration',
            properties: {
              type: {
                type: 'string',
                enum: ['tight', 'default', 'wide', 'panda'],
                description: 'Range type (tight 10-30%, default 40-57%, wide 60%+, panda 85-90%)',
              },
              binsBelowPct: { type: 'number', description: 'How far below entry price the range covers (%)' },
              notes: { type: 'string' },
            },
          },
          exit: {
            type: 'object',
            properties: {
              takeProfitPct: { type: 'number', description: 'Take profit threshold %' },
              notes: { type: 'string' },
            },
          },
          bestFor: { type: 'string', description: 'Short description of ideal market conditions for this strategy' },
          raw: { type: 'string', description: 'Original tweet or text the strategy was parsed from' },
        },
        required: ['id', 'name'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_strategies',
      description:
        'List all saved strategies in the library with a summary of each. Shows which one is currently active.',
      parameters: { type: 'object', properties: {} },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_strategy',
      description:
        'Get full details of a specific strategy including all criteria, range settings, and original raw text.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Strategy ID from list_strategies' },
        },
        required: ['id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'set_active_strategy',
      description: `Set which strategy to use for the next screening/deployment cycle.
The active strategy's token criteria, entry conditions, range, and exit rules will be applied.
Call list_strategies first to see available options.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Strategy ID to activate' },
        },
        required: ['id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'remove_strategy',
      description: 'Remove a strategy from the library.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Strategy ID to remove' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Lesson Management ─────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'list_lessons',
      description: `Browse saved lessons with optional filters.
Use to find a lesson ID before pinning/unpinning, or to audit what the agent currently knows.`,
      parameters: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['SCREENER', 'MANAGER', 'GENERAL'], description: 'Filter by role' },
          pinned: { type: 'boolean', description: 'Filter to only pinned (true) or unpinned (false) lessons' },
          tag: { type: 'string', description: 'Filter by a specific tag' },
          limit: { type: 'number', description: 'Max lessons to return (default 30)' },
        },
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'pin_lesson',
      description: `Pin a lesson by ID so it's always injected into the prompt regardless of memory cap.
Use for critical rules that must never be forgotten — e.g. narrative criteria, hard risk rules.
Call list_lessons first to find the lesson ID.`,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Lesson ID (from list_lessons)' },
        },
        required: ['id'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'unpin_lesson',
      description: 'Unpin a previously pinned lesson. It will re-enter the normal rotation.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Lesson ID to unpin' },
        },
        required: ['id'],
      },
    },
  },

  // ─── Performance History ────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'get_performance_history',
      description: `Retrieve closed position records filtered by time window.
Use when the user asks about recent performance, last 24h positions, how you've been doing, P&L history, etc.
Returns individual closed positions with PnL, fees, strategy, hold time, and close reason.`,
      parameters: {
        type: 'object',
        properties: {
          hours: {
            type: 'number',
            description: 'How many hours back to look (default 24). Use 168 for last 7 days.',
          },
          limit: {
            type: 'number',
            description: 'Max records to return (default 50)',
          },
        },
      },
    },
  },

  // ─── Pool Memory ────────────────────────────────────────────────

  {
    type: 'function',
    function: {
      name: 'get_pool_memory',
      description: `Check your deploy history for a pool BEFORE deploying.
Returns all past deploys, PnL, win rate, and any notes you've added.

Call this tool before deploying to any pool — you may have been here before and it didn't work.
Also useful during screening to skip pools with a bad track record.`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: {
            type: 'string',
            description: 'The pool address to look up',
          },
        },
        required: ['pool_address'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'add_pool_note',
      description: `Annotate a pool with a freeform note that persists across sessions.
Use when you observe something worth remembering about a specific pool:
- "volume dried up after 2h — avoid during off-hours"
- "consistently good during Asian session"
- "rugged base token — monitor closely"`,
      parameters: {
        type: 'object',
        properties: {
          pool_address: {
            type: 'string',
            description: 'Pool address to annotate',
          },
          note: {
            type: 'string',
            description: 'The note to save',
          },
        },
        required: ['pool_address', 'note'],
      },
    },
  },

  // ─── Token Blacklist ────────────────────────────────────────────
]
