// =============================================================================
// SF2 template — DepEd's official School Form 2, filled in for one section
// =============================================================================
// The attendance import reads the school's SF2 (Daily Attendance Report of
// Learners). This builds the blank for a section and month FROM DEPED'S OWN
// FILE, not from a look-alike: backend/templates/deped-school-forms-2013.xlsx
// is the official "School Forms" workbook (author "Deped", 2013 — the
// modified School Forms of DepEd Order No. 4, s. 2014, prepared and checked
// under DO 11, s. 2018), published by the DepEd Division of Catanduanes. See
// backend/templates/README.md for the source.
//
// Why the XML is edited directly instead of going through ExcelJS: the SF2
// sheet carries DepEd's logo (one image is a WMF) and drawing anchors beside
// the total rows, which ExcelJS does not round-trip faithfully. Editing the
// sheet XML keeps every style, merge, border, drawing and print setting
// exactly as DepEd made them; only the blank cells are written:
//
//   C6   School ID         (left blank — the System has no School ID)
//   K6   School Year       X6  Report for the Month of
//   C8   Name of School    X8  Grade Level       AC8 Section
//   D11… the date of each school day, D12… its day letter (M T W TH F)
//   A/B  rows 14–34 the male learners, rows 36–60 the female learners
//        (numbered in A, "Last Name, First Name Middle Name" in B:C)
//
// The guidelines, the codes legend, the summary table and the signature
// lines are left untouched. The other six forms are removed so the
// downloaded file opens straight on SF2 and the importer reads it as the
// first sheet.
// =============================================================================
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'deped-school-forms-2013.xlsx');
const SF2_SHEET_NAME = 'School Form 2 (SF2)';

// The official sheet's layout (read cell by cell from DepEd's file).
const LAYOUT = {
  schoolYear: 'K6',
  month: 'X6',
  schoolName: 'C8',
  gradeLevel: 'X8',
  section: 'AC8',
  dateRow: 11,
  dayRow: 12,
  firstDayColumn: 4,   // D
  dayColumns: 25,      // D..AB
  maleFirstRow: 14,
  maleLastRow: 34,     // "MALE | TOTAL Per Day" is row 35
  femaleFirstRow: 36,
  femaleLastRow: 60,   // "FEMALE | TOTAL Per Day" is row 61
};
const DAY_LETTERS = ['', 'M', 'T', 'W', 'TH', 'F', ''];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- cell refs
function colToNumber(col) {
  return col.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
}
function numberToCol(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const escapeXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The Monday-to-Friday dates of a month, as { day, letter }. The System holds
// no holiday calendar, so every weekday is listed; the adviser leaves a
// holiday column blank or deletes its date. At most 23 — the form has 25.
function schoolDaysOfMonth(year, month) {
  const days = [];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= last; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday >= 1 && weekday <= 5) days.push({ day, letter: DAY_LETTERS[weekday] });
  }
  return days;
}

// ---------------------------------------------------------------- sheet XML
// Writes one cell, keeping its existing style (s="…"). Text goes in as an
// inline string so the workbook's shared-string table is left untouched.
function setCell(sheetXml, ref, value) {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  const rowNumber = Number(match[2]);
  const rowRe = new RegExp(`<row r="${rowNumber}"[^>]*>([\\s\\S]*?)</row>`);
  const rowMatch = sheetXml.match(rowRe);
  if (!rowMatch) throw new Error(`SF2 template: row ${rowNumber} not found`);
  const cellRe = new RegExp(`<c r="${ref}"((?: [^>]*?)?)(?:/>|>[\\s\\S]*?</c>)`);
  const cellMatch = rowMatch[0].match(cellRe);
  if (!cellMatch) throw new Error(`SF2 template: cell ${ref} not found`);
  const style = (cellMatch[1].match(/ s="\d+"/) || [''])[0];
  const xml = typeof value === 'number'
    ? `<c r="${ref}"${style}><v>${value}</v></c>`
    : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  const newRow = rowMatch[0].replace(cellMatch[0], xml);
  return sheetXml.replace(rowMatch[0], newRow);
}

// Inserts `count` copies of row `afterRow` directly below it, shifting every
// row, cell reference, merge and drawing anchor below. Used only when a
// section has more learners than the form's 21 male or 25 female rows.
// Safe because the SF2 sheet has no formulas.
function insertRows(sheetXml, drawingXml, afterRow, count) {
  if (count <= 0) return { sheetXml, drawingXml };
  const shiftRef = (ref) => ref.replace(/([A-Z]+)(\d+)/g, (m, col, row) => (Number(row) > afterRow ? `${col}${Number(row) + count}` : m));

  // 1. shift rows below, renumbering their cells
  sheetXml = sheetXml.replace(/<row r="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g, (whole, r, attrs, inner) => {
    const n = Number(r);
    if (n <= afterRow) return whole;
    return `<row r="${n + count}"${attrs}>${inner.replace(/<c r="([A-Z]+)(\d+)"/g, (m, col) => `<c r="${col}${n + count}"`)}</row>`;
  });
  // 2. copies of the template row (empty learner row), right after it
  const template = sheetXml.match(new RegExp(`<row r="${afterRow}"[^>]*>[\\s\\S]*?</row>`))[0];
  const copies = [];
  for (let i = 1; i <= count; i += 1) {
    const n = afterRow + i;
    copies.push(template.replace(`<row r="${afterRow}"`, `<row r="${n}"`).replace(/<c r="([A-Z]+)\d+"/g, (m, col) => `<c r="${col}${n}"`));
  }
  sheetXml = sheetXml.replace(template, template + copies.join(''));
  // 3. merges: shift those below, and repeat the template row's own merges
  const rowMerges = [];
  sheetXml = sheetXml.replace(/<mergeCell ref="([^"]+)"\/>/g, (m, ref) => {
    if (new RegExp(`^[A-Z]+${afterRow}:[A-Z]+${afterRow}$`).test(ref)) rowMerges.push(ref);
    return `<mergeCell ref="${shiftRef(ref)}"/>`;
  });
  const added = [];
  for (let i = 1; i <= count; i += 1) {
    for (const ref of rowMerges) added.push(`<mergeCell ref="${ref.replace(new RegExp(`${afterRow}`, 'g'), String(afterRow + i))}"/>`);
  }
  sheetXml = sheetXml.replace(/<mergeCells count="(\d+)">/, (m, c) => `<mergeCells count="${Number(c) + added.length}">`)
    .replace('</mergeCells>', `${added.join('')}</mergeCells>`);
  // 4. the sheet's dimension, and drawing anchors (0-based rows) below
  sheetXml = sheetXml.replace(/<dimension ref="([^"]+)"\/>/, (m, ref) => `<dimension ref="${shiftRef(ref)}"/>`);
  if (drawingXml) {
    drawingXml = drawingXml.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (m, r) => (Number(r) >= afterRow ? `<xdr:row>${Number(r) + count}</xdr:row>` : m));
  }
  return { sheetXml, drawingXml };
}

// ---------------------------------------------------------------- workbook
// Removes every sheet except SF2 from the package: the sheet list, the
// workbook relationships, the parts themselves, their content types, the
// other sheets' defined names, and the sheet titles in docProps/app.xml.
async function keepOnlySf2(zip) {
  let workbook = await zip.file('xl/workbook.xml').async('string');
  let rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let types = await zip.file('[Content_Types].xml').async('string');

  const sheets = [...workbook.matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="([^"]+)"\/>/g)].map((m, index) => ({ name: m[1], rid: m[2], index }));
  const sf2 = sheets.find((s) => s.name === SF2_SHEET_NAME);
  if (!sf2) throw new Error('SF2 template: the official workbook has no SF2 sheet');
  const targetOf = (rid) => rels.match(new RegExp(`<Relationship Id="${rid}"[^>]*Target="([^"]+)"`))[1];

  for (const sheet of sheets.filter((s) => s !== sf2)) {
    const part = `xl/${targetOf(sheet.rid)}`;
    const relsPart = part.replace('worksheets/', 'worksheets/_rels/') + '.rels';
    const sheetRels = zip.file(relsPart) ? await zip.file(relsPart).async('string') : '';
    for (const m of sheetRels.matchAll(/Target="\.\.\/(drawings\/[^"]+|printerSettings\/[^"]+)"/g)) {
      const drawing = `xl/${m[1]}`;
      zip.remove(drawing);
      zip.remove(drawing.replace('drawings/', 'drawings/_rels/') + '.rels');
      types = types.replace(new RegExp(`<Override PartName="/${drawing}"[^>]*/>`), '');
    }
    zip.remove(part);
    zip.remove(relsPart);
    types = types.replace(new RegExp(`<Override PartName="/${part}"[^>]*/>`), '');
    rels = rels.replace(new RegExp(`<Relationship Id="${sheet.rid}"[^>]*/>`), '');
    workbook = workbook.replace(new RegExp(`<sheet name="${sheet.name.replace(/[()]/g, '\\$&')}"[^>]*/>`), '');
  }
  // Defined names: keep only SF2's (its print titles), now sheet index 0.
  workbook = workbook.replace(/<definedName [^>]*localSheetId="(\d+)"[^>]*>[^<]*<\/definedName>/g, (m, id) =>
    (Number(id) === sf2.index ? m.replace(`localSheetId="${id}"`, 'localSheetId="0"') : ''));
  workbook = workbook.replace(/activeTab="\d+"/, 'activeTab="0"').replace(/ firstSheet="\d+"/, '');

  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/_rels/workbook.xml.rels', rels);
  zip.file('[Content_Types].xml', types);
  if (zip.file('docProps/app.xml')) {
    const app = (await zip.file('docProps/app.xml').async('string'))
      .replace(/<HeadingPairs>[\s\S]*<\/HeadingPairs>/, '<HeadingPairs><vt:vector size="4" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant><vt:variant><vt:lpstr>Named Ranges</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>')
      .replace(/<TitlesOfParts>[\s\S]*<\/TitlesOfParts>/, `<TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>${SF2_SHEET_NAME}</vt:lpstr><vt:lpstr>'${SF2_SHEET_NAME}'!Print_Titles</vt:lpstr></vt:vector></TitlesOfParts>`);
    zip.file('docProps/app.xml', app);
  }
  return `xl/${targetOf(sf2.rid)}`;
}

// Builds the filled-in SF2 for one section and month.
//   section: { schoolName, schoolYear, gradeLevel, sectionName }
//   learners: [{ name: 'Last, First Middle', sex: 'M' | 'F' | null }]
async function buildSf2Template({ schoolName, schoolYear, gradeLevel, sectionName, month, year, learners }) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));
  const sheetPart = await keepOnlySf2(zip);
  const sheetRelsPart = sheetPart.replace('worksheets/', 'worksheets/_rels/') + '.rels';
  const sheetRels = await zip.file(sheetRelsPart).async('string');
  const drawingTarget = (sheetRels.match(/Target="\.\.\/(drawings\/[^"]+)"/) || [])[1];
  const drawingPart = drawingTarget ? `xl/${drawingTarget}` : null;

  let sheetXml = await zip.file(sheetPart).async('string');
  let drawingXml = drawingPart ? await zip.file(drawingPart).async('string') : null;

  // Males first, then females — the order the form prescribes. A learner
  // with no sex recorded is listed with the males rather than left out.
  const males = learners.filter((l) => l.sex !== 'F');
  const females = learners.filter((l) => l.sex === 'F');

  // Extra rows when a block is longer than the form's. The female block is
  // grown first so the male insertion (above it) shifts it as a whole.
  const femaleExtra = Math.max(0, females.length - (LAYOUT.femaleLastRow - LAYOUT.femaleFirstRow + 1));
  ({ sheetXml, drawingXml } = insertRows(sheetXml, drawingXml, LAYOUT.femaleLastRow, femaleExtra));
  const maleExtra = Math.max(0, males.length - (LAYOUT.maleLastRow - LAYOUT.maleFirstRow + 1));
  ({ sheetXml, drawingXml } = insertRows(sheetXml, drawingXml, LAYOUT.maleLastRow, maleExtra));
  const femaleFirstRow = LAYOUT.femaleFirstRow + maleExtra;

  // Header block.
  sheetXml = setCell(sheetXml, LAYOUT.schoolYear, schoolYear || '');
  sheetXml = setCell(sheetXml, LAYOUT.month, `${MONTH_NAMES[month - 1]} ${year}`);
  sheetXml = setCell(sheetXml, LAYOUT.schoolName, schoolName || '');
  // Just the number: the form's own label already reads "Grade Level".
  sheetXml = setCell(sheetXml, LAYOUT.gradeLevel, gradeLevel ? String(gradeLevel) : '');
  sheetXml = setCell(sheetXml, LAYOUT.section, sectionName || '');

  // "1st row for date, 2nd row for Day: M,T,W,TH,F"
  const days = schoolDaysOfMonth(year, month).slice(0, LAYOUT.dayColumns);
  days.forEach(({ day, letter }, i) => {
    const col = numberToCol(LAYOUT.firstDayColumn + i);
    sheetXml = setCell(sheetXml, `${col}${LAYOUT.dateRow}`, day);
    sheetXml = setCell(sheetXml, `${col}${LAYOUT.dayRow}`, letter);
  });

  // Learners, numbered within each block as the form does.
  males.forEach((l, i) => {
    sheetXml = setCell(sheetXml, `A${LAYOUT.maleFirstRow + i}`, i + 1);
    sheetXml = setCell(sheetXml, `B${LAYOUT.maleFirstRow + i}`, l.name);
  });
  females.forEach((l, i) => {
    sheetXml = setCell(sheetXml, `A${femaleFirstRow + i}`, i + 1);
    sheetXml = setCell(sheetXml, `B${femaleFirstRow + i}`, l.name);
  });

  zip.file(sheetPart, sheetXml);
  if (drawingPart) zip.file(drawingPart, drawingXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { buildSf2Template, schoolDaysOfMonth, LAYOUT, TEMPLATE_PATH, colToNumber, numberToCol };
