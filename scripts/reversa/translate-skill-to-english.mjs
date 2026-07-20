#!/usr/bin/env node
/*
  Usage:
    node translate-skill-to-english.mjs <repo_root> <backup_dir> <model>

  Args are passed by scripts/reversa/translate-skills-parallel.sh.
*/
const fs = require('node:fs/promises');
const path = require('node:path');

async function callOpenAI(apiKey, model, text) {
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are a senior technical translator. Translate Portuguese Markdown to clear US English. '
          + 'Preserve all markdown structure, code blocks, inline commands, YAML, file paths, variable names, and indentation. '
          + 'Do not change code semantics. Do not add examples. Return only the translated file content.'
      },
      {
        role: 'user',
        content: `Translate this file to English:\n\n${text}`
      }
    ],
    temperature: 0.2
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt}`);
  }

  const payload = await res.json();
  const translated = payload?.choices?.[0]?.message?.content;
  if (!translated || typeof translated !== 'string') {
    throw new Error('OpenAI did not return translated content.');
  }

  return translated.trimEnd() + '\n';
}

async function main() {
  const [repoRoot, backupRoot, model, file] = process.argv.slice(2);

  if (!repoRoot || !backupRoot || !model) {
    throw new Error('Usage: translate-skill-to-english.mjs <repoRoot> <backupRoot> <model> <file> (file is passed as $0 arg by xargs)');
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set.');

  const absoluteFile = path.resolve(file);
  const original = await fs.readFile(absoluteFile, 'utf8');

  const translated = await callOpenAI(apiKey, model, original);
  const rel = path.relative(repoRoot, absoluteFile);
  const backupPath = path.join(backupRoot, rel + '.bak');
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.copyFile(absoluteFile, backupPath);

  const tmp = absoluteFile + '.tmp';
  await fs.writeFile(tmp, translated, 'utf8');
  await fs.rename(tmp, absoluteFile);

  console.log(`[ok] ${rel}`);
}

main().catch((err) => {
  const file = process.argv[5] || 'unknown';
  console.error(`[err] ${path.basename(file)}: ${err.message}`);
  process.exit(1);
});
