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

  // Was the blind split (2026-10-22). Read case by case on 2026-10-30, so now holdout.
  {
    question: "the shipping update for my order",
    pool: [...NOISE],
    expect: [2],
    split: "holdout",
  },
  {
    question: "notes from the design review",
    pool: pool({ from: "Leo Martins", subject: "Design review notes", preview: "Summary of feedback on the onboarding flow.", hoursAgo: 30 }),
    expect: [8],
    split: "holdout",
  },
  {
    question: "anything about the mortgage",
    pool: [...NOISE],
    expect: [],
    noneExpected: true,
    split: "holdout",
  },

  // Added to dev (2026-10-30): the right email uses other words than the
  // question, next to a distractor that shares one of them.
  {
    question: "the agreement with the vendor",
    pool: pool(
      { from: "Legal", subject: "Contract for review", preview: "Final contract with Acme Supplies, signature page included.", hoursAgo: 20 },
      { from: "Events Team", subject: "Vendor fair booths", preview: "Booths for the spring vendor fair are now open.", hoursAgo: 15 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "my boarding pass",
    pool: pool(
      { from: "TAP Air Portugal", subject: "Check-in is open for TP1234", preview: "Check in now and get your mobile pass for Lisbon.", hoursAgo: 6 },
      { from: "Sam Okafor", subject: "Boarding the train now", preview: "Will be there by 6.", hoursAgo: 3 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "the bill from the dentist",
    pool: pool(
      { from: "Smile Dental", subject: "Invoice for your visit on Oct 12", preview: "Amount due $140. Pay online.", hoursAgo: 40 },
      { from: "Bill Turner", subject: "Re: garden fence", preview: "Happy to split the cost with you.", hoursAgo: 10 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "news about the launch",
    pool: pool(
      { from: "Maya Chen", subject: "Launch moved to the 20th", preview: "We slipped a week, details inside.", hoursAgo: 8 },
      { from: "Morning Brew", subject: "Today's news: markets rally", preview: "Stocks closed higher on tech earnings.", hoursAgo: 4 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "latest on the apartment lease",
    pool: pool(
      { from: "Harbor Rentals", subject: "Your lease renewal", preview: "Please sign the renewal for flat 4B by Nov 15.", hoursAgo: 30 },
      { from: "Leo Martins", subject: "Latest mockups", preview: "Here are the latest screens for the app.", hoursAgo: 2 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "the signed NDA",
    pool: pool({ from: "Jonas Weber", subject: "NDA back", preview: "Attached the countersigned copy.", hoursAgo: 12 }),
    expect: [8],
    split: "dev",
  },
  {
    question: "the slides maya updated",
    pool: pool(
      { from: "Maya Chen", subject: "Deck v3", preview: "Updated the slides with the new numbers.", hoursAgo: 14 },
      { from: "Status Page", subject: "Service updated", preview: "We updated our API to version 2.", hoursAgo: 7 },
    ),
    expect: [8],
    split: "dev",
  },
  {
    question: "my vaccine appointment",
    pool: [...NOISE],
    expect: [],
    noneExpected: true,
    split: "dev",
  },
];
