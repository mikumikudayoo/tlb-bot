import { readFileSync } from 'node:fs';
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

// Keep Discord help and the player guide on disk in sync automatically.
const guide = readFileSync(new URL('../../docs/PLAYER_GUIDE.md', import.meta.url), 'utf8');
export const HELP_TOPICS = guide.split(/^## /m).slice(1).map(section => {
  const [title, ...lines] = section.trim().split(/\r?\n/);
  return { title: title!, value: title!.toLowerCase().replace(/[^a-z0-9]+/g, '-'), body: lines.join('\n').trim() };
});

export const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('read the player guide: commands, stats, equipment, ordeals and more')
  .addStringOption(option => option.setName('topic').setDescription('choose a guide chapter; defaults to getting started')
    .addChoices(...HELP_TOPICS.map(topic => ({ name: topic.title, value: topic.value }))));

// Discord does not render Markdown tables. Turn each row into labelled text.
function discordMarkdown(body: string) {
  let headers: string[] = [];
  return body.split('\n').flatMap(line => {
    if (!line.startsWith('|')) { headers = []; return [line]; }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (!headers.length) { headers = cells; return []; }
    if (cells.every(cell => /^:?-+:?$/.test(cell))) return [];
    return [`• ${cells.map((cell, i) => `${headers[i]}: ${cell}`).join(' · ')}`];
  }).join('\n');
}

export async function handleHelpCommand(interaction: any) {
  const requested = interaction.options.getString('topic') ?? 'getting-started';
  const topic = HELP_TOPICS.find(entry => entry.value === requested);
  if (!topic) return interaction.reply({ content: 'unknown guide topic — use /help and pick a topic from the list.', flags: MessageFlags.Ephemeral });
  const body = discordMarkdown(topic.body);
  const pages: string[] = [];
  let page = '';
  for (const line of body.split('\n')) {
    if (page.length + line.length + 1 > 3800) { pages.push(page); page = ''; }
    page += `${line}\n`;
  }
  if (page) pages.push(page);
  return interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: pages.map((description, index) => new EmbedBuilder()
      .setColor(0x80d8d0)
      .setTitle(`facility guide · ${topic.title}${pages.length > 1 ? ` (${index + 1}/${pages.length})` : ''}`)
      .setDescription(description)
      .setFooter({ text: 'looking for something else? /help topic:…' })),
  });
}
