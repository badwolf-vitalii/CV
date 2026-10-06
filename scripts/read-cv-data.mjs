import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

const EUROPASS_LANGUAGE_SKILLS = {
  Italian: {
    listening: 'C1',
    reading: 'C1',
    spokenInteraction: 'B2',
    spokenProduction: 'B2',
    writing: 'B2',
  },
  English: {
    listening: 'B2',
    reading: 'C1',
    spokenInteraction: 'B2',
    spokenProduction: 'B2',
    writing: 'B2',
  },
  Russian: {
    listening: 'C2',
    reading: 'C2',
    spokenInteraction: 'C2',
    spokenProduction: 'C2',
    writing: 'C2',
  },
};

function typstText(value) {
  return String(value ?? '')
    .replace(/\\#/g, '#')
    .replace(/\\_/g, '_')
    .replace(/\\\*/g, '*')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();
}

function unquote(value) {
  const text = value.trim();
  if (!text.startsWith('"') || !text.endsWith('"')) {
    throw new Error(`Expected quoted Typst string, got: ${text.slice(0, 80)}`);
  }
  return typstText(text.slice(1, -1));
}

function readCall(source, marker, fromIndex) {
  const start = source.indexOf(marker, fromIndex);
  if (start < 0) return null;

  const open = source.indexOf('(', start + marker.length - 1);
  let depth = 0;
  let square = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') square += 1;
    if (ch === ']') square -= 1;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0 && square === 0) {
        return { start, end: i + 1, body: source.slice(open + 1, i) };
      }
    }
  }

  throw new Error(`Unterminated ${marker} call in cv.typ`);
}

function splitTopLevelArguments(body) {
  const args = [];
  let current = '';
  let paren = 0;
  let square = 0;
  let inString = false;
  let escaped = false;

  for (const ch of body) {
    if (inString) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === '(') paren += 1;
    if (ch === ')') paren -= 1;
    if (ch === '[') square += 1;
    if (ch === ']') square -= 1;

    if (ch === ',' && paren === 0 && square === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) args.push(current.trim());
  return args;
}

function extractCalls(source, marker) {
  const calls = [];
  let cursor = 0;
  while (true) {
    const call = readCall(source, marker, cursor);
    if (!call) break;
    calls.push(splitTopLevelArguments(call.body));
    cursor = call.end;
  }
  return calls;
}

function parsePeriod(period) {
  const [fromRaw, toRaw] = period.split(/\s+-\s+/).map((x) => x.trim());

  function parseOne(value) {
    if (!value || /^present$/i.test(value)) return null;
    const match = value.match(/^([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) throw new Error(`Unsupported period value: ${value}`);
    const month = MONTHS[match[1].toLowerCase()];
    if (!month) throw new Error(`Unsupported month in period: ${value}`);
    return `${match[2]}-${month}`;
  }

  return { start: parseOne(fromRaw), end: parseOne(toRaw) };
}

function parseLocation(value) {
  const parts = value.split(',').map((x) => x.trim()).filter(Boolean);
  const country = parts.length > 1 ? parts.at(-1) : '';
  const cityPart = parts.length > 1 ? parts.slice(0, -1).join(', ') : value;
  const match = cityPart.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return {
    display: value,
    city: (match ? match[1] : cityPart).trim(),
    region: match ? match[2].trim() : '',
    country,
  };
}

function parseBullets(arg) {
  return arg
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map(typstText);
}

function extractSectionBody(source, title) {
  const marker = `#section("${title}")`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Section not found in cv.typ: ${title}`);
  const after = source.slice(start + marker.length);
  const next = after.search(/\n\]\s*(?:\n|$)/);
  return (next >= 0 ? after.slice(0, next) : after).trim();
}

function parseEducation(source) {
  const body = extractSectionBody(source, 'EDUCATION & LANGUAGES');
  const entries = [];
  const re = /^\s*\*([^*]+)\*\s*-\s*(.+?),\s*([^,\n]+)\s*\((\d{4})-(\d{4})\)\s*\\?$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    entries.push({
      qualification: typstText(match[1]),
      institution: typstText(match[2]),
      country: typstText(match[3]),
      start: `${match[4]}-01`,
      end: `${match[5]}-12`,
    });
  }
  return entries;
}

function parseLanguages(source) {
  const body = extractSectionBody(source, 'EDUCATION & LANGUAGES');
  const match = body.match(/\*Languages:\*\s*(.+)$/m);
  if (!match) return [];
  return match[1].split('|').map((part) => {
    const [language, level] = part.split(/\s+-\s+/).map((x) => typstText(x));
    const defaultSkills = /native/i.test(level)
      ? null
      : {
          listening: level,
          reading: level,
          spokenInteraction: level,
          spokenProduction: level,
          writing: level,
        };

    return {
      language,
      level,
      skills: EUROPASS_LANGUAGE_SKILLS[language] ?? defaultSkills,
    };
  });
}

function parseSkills(source) {
  const body = extractSectionBody(source, 'TECHNICAL SKILLS');
  const items = [];
  const re = /^\s*\*([^*]+):\*\s*(.*?)\s*\\?$/gm;
  let match;
  while ((match = re.exec(body)) !== null) {
    items.push({ category: typstText(match[1]), value: typstText(match[2]) });
  }
  return items;
}

function firstMatch(source, regex, name) {
  const match = source.match(regex);
  if (!match) throw new Error(`Could not read ${name} from cv.typ`);
  return typstText(match[1]);
}

export function loadCvData(root) {
  const cvPath = path.join(root, 'cv.typ');
  const personalPath = path.join(root, 'personal.yaml');

  if (!fs.existsSync(cvPath)) throw new Error(`Missing ${cvPath}`);
  if (!fs.existsSync(personalPath)) throw new Error('personal.yaml is missing. Create it before running Europass automation.');

  const source = fs.readFileSync(cvPath, 'utf8');
  const personal = YAML.parse(fs.readFileSync(personalPath, 'utf8')) ?? {};

  const name = firstMatch(source, /#text\(size:\s*20pt,[^\]]*\)\[([^\]]+)\]/, 'name');
  const headline = firstMatch(source, /#text\(size:\s*11pt,[^\]]*\)\[([^\]]+)\]/, 'headline');
  const summary = typstText(extractSectionBody(source, 'PROFESSIONAL SUMMARY'));

  const work = extractCalls(source, '#role(').map((args) => {
    if (args.length < 5) throw new Error('Unexpected role(...) structure in cv.typ');
    const period = unquote(args[1]);
    return {
      title: unquote(args[0]),
      period,
      ...parsePeriod(period),
      company: unquote(args[2]),
      location: parseLocation(unquote(args[3])),
      bullets: parseBullets(args[4]),
    };
  });

  const projects = extractCalls(source, '#project(').map((args) => {
    if (args.length < 4) throw new Error('Unexpected project(...) structure in cv.typ');
    return {
      name: unquote(args[0]),
      url: unquote(args[1]),
      description: unquote(args[2]),
      tech: unquote(args[3]),
    };
  });

  const profiles = {};
  const linkedin = source.match(/#link\("(https:\/\/linkedin\.com\/[^"?]+)"\)/)?.[1];
  const github = source.match(/#link\("(https:\/\/github\.com\/[^"?]+)"\)/)?.[1];
  if (linkedin) profiles.linkedin = linkedin;
  if (github) profiles.github = github;

  const nameParts = name.split(/\s+/);
  const lastName = nameParts.pop() ?? '';
  const firstName = nameParts.join(' ');

  const photoPath = personal.photo_path
    ? path.resolve(root, String(personal.photo_path))
    : null;

  return {
    firstName,
    lastName,
    name,
    headline,
    summary,
    contact: {
      location: parseLocation(String(personal.location ?? '')),
      phone: String(personal.phone ?? ''),
      email: String(personal.email ?? ''),
      photoPath,
      showPhoto: Boolean(personal.show_photo),
      ...profiles,
    },
    skills: parseSkills(source),
    work,
    projects,
    education: parseEducation(source),
    languages: parseLanguages(source),
  };
}
