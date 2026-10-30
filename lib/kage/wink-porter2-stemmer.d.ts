declare module "wink-porter2-stemmer" {
  /** Porter2 (Snowball English) stem of one lowercase word. */
  export default function stem(word: string): string;
}
