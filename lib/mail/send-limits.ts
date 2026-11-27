export const SEND_LIMITS = {
  vercel: { body: "4.5mb", budget: 4_200_000 },
  selfHosted: { body: "26mb", budget: 25_690_112 },
} as const;

export const MAX_FILES = 20;
