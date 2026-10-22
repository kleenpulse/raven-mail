/*
 * Semantic-find cases for `bun run eval:kage`. Each pool is the candidate list
 * `jevRank` would see; `expect` holds the indexes that should rank top-3.
 * `noneExpected` means no candidate answers the question.
 */
export type RankCandidate = { from: string; subject: string; preview: string; hoursAgo: number };
export type RankCase = {
  question: string;
  pool: RankCandidate[];
  expect: number[];
  noneExpected?: boolean;
  split: "dev" | "holdout" | "blind";
};

const NOISE: RankCandidate[] = [
  { from: "GitHub", subject: "[raven] CI failed on main", preview: "Build #812 failed in 3m. View logs.", hoursAgo: 2 },
  { from: "Lenny's Newsletter", subject: "How to price a B2B product", preview: "Pricing frameworks from 30 founders.", hoursAgo: 5 },
  { from: "Amazon", subject: "Your order has shipped", preview: "Arriving Thursday. Track your package.", hoursAgo: 9 },
  { from: "Priya Raman", subject: "Lunch next week?", preview: "Are you free Tuesday or Wednesday?", hoursAgo: 20 },
  { from: "Stripe", subject: "Your receipt #1043", preview: "Amount paid $49.00", hoursAgo: 30 },
  { from: "Figma", subject: "Your verification code", preview: "Use 482913 to sign in.", hoursAgo: 40 },
  { from: "Sam Okafor", subject: "Weekend climbing?", preview: "Thinking Saturday morning at the gym.", hoursAgo: 52 },
  { from: "Google Calendar", subject: "Invitation: 1:1 @ Mon 10am", preview: "Join with Google Meet.", hoursAgo: 60 },
];

const pool = (...hits: RankCandidate[]) => [...NOISE, ...hits];

export const RANK_CASES: RankCase[] = [
  {
    question: "Anything about the roadmap?",
    pool: pool(
      { from: "Maya Chen", subject: "2027 product roadmap draft", preview: "Here's the first pass at next year's roadmap.", hoursAgo: 12 },
      { from: "Jonas Weber", subject: "Re: roadmap priorities", preview: "I'd move search ahead of integrations.", hoursAgo: 30 },
    ),
    expect: [8, 9],
    split: "dev",
  },
  {
    question: "the email about the offsite venue",
    pool: pool(
      { from: "Leo Martins", subject: "Offsite logistics", preview: "Two venue options in Lisbon, both fit 20 people.", hoursAgo: 70 },
    ),
    expect: [8],
    split: "holdout",
  },
  {
    question: "where's that thread on the Q3 budget",
    pool: pool(
      { from: "Maya Chen", subject: "Q3 budget review", preview: "Marketing is 12% over plan.", hoursAgo: 100 },
      { from: "Finance", subject: "Budget template", preview: "Use this sheet for next quarter's planning.", hoursAgo: 200 },
    ),
    expect: [8, 9],
    split: "dev",
  },
  {
    question: "did jonas say anything about the kubernetes migration",
    pool: pool(
      { from: "Jonas Weber", subject: "Cluster move plan", preview: "Kubernetes migration is scheduled for the 14th, staging first.", hoursAgo: 48 },
      { from: "Jonas Weber", subject: "Coffee?", preview: "Grabbing coffee at 3 if you want to join.", hoursAgo: 4 },
    ),
    expect: [8],
    split: "holdout",
  },
  {
    question: "hiring plan for engineers",
    pool: pool(
      { from: "Maya Chen", subject: "Re: hiring plan", preview: "We can open two engineering roles in Q1.", hoursAgo: 80 },
      { from: "Recruiter", subject: "Senior engineer candidates", preview: "Three profiles for the platform team.", hoursAgo: 90 },
    ),
    expect: [8, 9],
    split: "dev",
  },
  {
    question: "the photos from the trip",
    pool: pool(
      { from: "Priya Raman", subject: "Trip pics!", preview: "Uploaded all the photos from Porto to the shared album.", hoursAgo: 150 },
    ),
    expect: [8],
    split: "holdout",
  },
  {
    question: "anything about the tax return",
    pool: [...NOISE],
    expect: [],
    noneExpected: true,
    split: "dev",
  },
  {
    question: "which email has the contract to sign",
    pool: pool(
      { from: "Legal", subject: "Vendor agreement — signature needed", preview: "Please sign the attached contract by Friday.", hoursAgo: 26 },
    ),
    expect: [8],
    split: "holdout",
  },
  {
    question: "the climbing plans with sam",
    pool: [...NOISE],
    expect: [6],
    split: "dev",
  },
  {
    question: "the failed build",
    pool: [...NOISE],
    expect: [0],
    split: "holdout",
  },
  {
    question: "where is the pricing article",
    pool: [...NOISE],
    expect: [1],
    split: "dev",
  },
  {
    question: "anything on the wedding seating chart",
    pool: [...NOISE],
    expect: [],
    noneExpected: true,
    split: "holdout",
  },

  // Blind split (2026-10-22).
  {
    question: "the shipping update for my order",
    pool: [...NOISE],
    expect: [2],
    split: "blind",
  },
  {
    question: "notes from the design review",
    pool: pool({ from: "Leo Martins", subject: "Design review notes", preview: "Summary of feedback on the onboarding flow.", hoursAgo: 30 }),
    expect: [8],
    split: "blind",
  },
  {
    question: "anything about the mortgage",
    pool: [...NOISE],
    expect: [],
    noneExpected: true,
    split: "blind",
  },
];
