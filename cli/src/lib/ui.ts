import { createInterface } from 'node:readline/promises';
import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];
const paint = (style: Style) => (text: string) => styleText(style, text);

export const bold = paint('bold');
export const dim = paint('dim');
export const red = paint('red');
export const green = paint('green');
export const yellow = paint('yellow');
export const cyan = paint('cyan');
export const magenta = paint('magenta');

export const log = {
  title: (text: string) => console.log(`\n${bold(text)}`),
  info: (text = '') => console.log(text),
  step: (text: string) => console.log(`${cyan('›')} ${text}`),
  ok: (text: string) => console.log(`${green('✔')} ${text}`),
  warn: (text: string) => console.log(`${yellow('!')} ${text}`),
  fail: (text: string) => console.log(`${red('✘')} ${text}`),
};

const ANSI = /\u001b\[[0-9;]*m/g;
const WIDE = /\p{Emoji_Presentation}/u;
const width = (text: string) => [...text.replace(ANSI, '')].reduce((sum, char) => sum + (WIDE.test(char) ? 2 : 1), 0);

/** Left-aligned text table; numbers are easier to compare when columns line up. */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header.map(bold), ...rows] : rows;
  const widths = all[0]?.map((_, column) => Math.max(...all.map((row) => width(row[column] ?? '')))) ?? [];
  return all
    .map((row) => row.map((cell, column) => cell + ' '.repeat((widths[column] ?? 0) - width(cell))).join('   ').trimEnd())
    .map((line) => `  ${line}`)
    .join('\n');
}

export function box(lines: string[]): string {
  const inner = Math.max(...lines.map(width));
  const top = `  ┌${'─'.repeat(inner + 2)}┐`;
  const bottom = `  └${'─'.repeat(inner + 2)}┘`;
  return [top, ...lines.map((line) => `  │ ${line}${' '.repeat(inner - width(line))} │`), bottom].join('\n');
}

export const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, { assumeYes = false } = {}): Promise<boolean> {
  if (assumeYes) return true;
  if (!interactive()) return false;
  return /^y(es)?$/i.test(await ask(`${question} ${dim('[y/N]')} `));
}

export async function choose(question: string, choices: { id: string; label: string }[]): Promise<string> {
  console.log(question);
  choices.forEach((choice, index) => console.log(`    ${cyan(String(index + 1))}) ${choice.label}`));
  for (;;) {
    const answer = await ask(`  ${dim(`1-${choices.length}`)} › `);
    const choice = choices[Number(answer) - 1];
    if (choice) return choice.id;
    log.warn(`Type a number between 1 and ${choices.length}.`);
  }
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export const stars = (difficulty: number) => '★'.repeat(difficulty) + '☆'.repeat(Math.max(0, 3 - difficulty));
