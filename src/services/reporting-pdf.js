const { getOpenSansSemiboldFont } = require('./fonts/open-sans-semibold');

function readUInt16(buffer, offset) {
  return buffer.readUInt16BE(offset);
}

function readInt16(buffer, offset) {
  return buffer.readInt16BE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function readInt32(buffer, offset) {
  return buffer.readInt32BE(offset);
}

function parseTableDirectory(buffer) {
  const numTables = readUInt16(buffer, 4);
  const tables = {};
  let offset = 12;
  for (let i = 0; i < numTables; i += 1) {
    const tag = buffer.toString('ascii', offset, offset + 4);
    const tableOffset = readUInt32(buffer, offset + 8);
    const length = readUInt32(buffer, offset + 12);
    tables[tag] = { offset: tableOffset, length };
    offset += 16;
  }
  return tables;
}

function parseHead(buffer, table) {
  const offset = table.offset;
  const unitsPerEm = readUInt16(buffer, offset + 18);
  const xMin = readInt16(buffer, offset + 36);
  const yMin = readInt16(buffer, offset + 38);
  const xMax = readInt16(buffer, offset + 40);
  const yMax = readInt16(buffer, offset + 42);
  return { unitsPerEm, bbox: [xMin, yMin, xMax, yMax] };
}

function parseHhea(buffer, table) {
  const offset = table.offset;
  const ascender = readInt16(buffer, offset + 4);
  const descender = readInt16(buffer, offset + 6);
  const numberOfHMetrics = readUInt16(buffer, offset + 34);
  return { ascender, descender, numberOfHMetrics };
}

function parseMaxp(buffer, table) {
  const offset = table.offset;
  const numGlyphs = readUInt16(buffer, offset + 4);
  return { numGlyphs };
}

function parseOS2(buffer, table) {
  const offset = table.offset;
  const version = readUInt16(buffer, offset);
  const usWeightClass = readUInt16(buffer, offset + 4);
  let sTypoAscender = null;
  let sTypoDescender = null;
  let sCapHeight = null;
  if (table.length >= 72) {
    sTypoAscender = readInt16(buffer, offset + 68);
    sTypoDescender = readInt16(buffer, offset + 70);
  }
  if (version >= 2 && table.length >= 90) {
    sCapHeight = readInt16(buffer, offset + 88);
  }
  return { usWeightClass, sTypoAscender, sTypoDescender, sCapHeight };
}

function parsePost(buffer, table) {
  const offset = table.offset;
  const rawAngle = readInt32(buffer, offset + 4);
  return { italicAngle: rawAngle / 65536 };
}

function parseHmtx(buffer, table, numberOfHMetrics, numGlyphs) {
  const widths = new Array(numGlyphs).fill(0);
  let offset = table.offset;
  let lastWidth = 0;
  for (let i = 0; i < numberOfHMetrics; i += 1) {
    const advance = readUInt16(buffer, offset);
    widths[i] = advance;
    lastWidth = advance;
    offset += 4;
  }
  for (let i = numberOfHMetrics; i < numGlyphs; i += 1) {
    widths[i] = lastWidth;
  }
  return widths;
}

function parseCmap(buffer, table) {
  const base = table.offset;
  const numTables = readUInt16(buffer, base + 2);
  let chosenOffset = null;
  for (let i = 0; i < numTables; i += 1) {
    const platformId = readUInt16(buffer, base + 4 + i * 8);
    const encodingId = readUInt16(buffer, base + 6 + i * 8);
    const subtableOffset = readUInt32(buffer, base + 8 + i * 8);
    if (
      (platformId === 3 && (encodingId === 1 || encodingId === 10)) ||
      platformId === 0
    ) {
      chosenOffset = base + subtableOffset;
      if (platformId === 3 && encodingId === 10) break;
    }
  }
  if (chosenOffset == null) {
    return new Map();
  }
  const format = readUInt16(buffer, chosenOffset);
  if (format !== 4) {
    return new Map();
  }
  const segCount = readUInt16(buffer, chosenOffset + 6) / 2;
  const endCountOffset = chosenOffset + 14;
  const startCountOffset = endCountOffset + 2 * segCount + 2;
  const idDeltaOffset = startCountOffset + 2 * segCount;
  const idRangeOffsetOffset = idDeltaOffset + 2 * segCount;
  const cmap = new Map();
  for (let i = 0; i < segCount; i += 1) {
    const endCode = readUInt16(buffer, endCountOffset + 2 * i);
    const startCode = readUInt16(buffer, startCountOffset + 2 * i);
    const idDelta = readInt16(buffer, idDeltaOffset + 2 * i);
    const idRangeOffset = readUInt16(buffer, idRangeOffsetOffset + 2 * i);
    for (let code = startCode; code <= endCode; code += 1) {
      if (code === 0xFFFF) continue;
      let glyphId = 0;
      if (idRangeOffset === 0) {
        glyphId = (code + idDelta) & 0xffff;
      } else {
        const glyphOffset =
          idRangeOffsetOffset +
          2 * i +
          idRangeOffset +
          2 * (code - startCode);
        if (glyphOffset < buffer.length - 1) {
          const glyphIndex = readUInt16(buffer, glyphOffset);
          if (glyphIndex !== 0) {
            glyphId = (glyphIndex + idDelta) & 0xffff;
          }
        }
      }
      cmap.set(code, glyphId);
    }
  }
  return cmap;
}

function parseFont(buffer) {
  const tables = parseTableDirectory(buffer);
  const head = parseHead(buffer, tables.head);
  const hhea = parseHhea(buffer, tables.hhea);
  const maxp = parseMaxp(buffer, tables.maxp);
  const os2 = tables['OS/2'] ? parseOS2(buffer, tables['OS/2']) : {};
  const post = tables.post ? parsePost(buffer, tables.post) : { italicAngle: 0 };
  const widths = parseHmtx(buffer, tables.hmtx, hhea.numberOfHMetrics, maxp.numGlyphs);
  const cmap = parseCmap(buffer, tables.cmap);
  return {
    buffer,
    unitsPerEm: head.unitsPerEm,
    bbox: head.bbox,
    ascender: os2.sTypoAscender != null ? os2.sTypoAscender : hhea.ascender,
    descender: os2.sTypoDescender != null ? os2.sTypoDescender : hhea.descender,
    capHeight: os2.sCapHeight != null ? os2.sCapHeight : Math.round((os2.sTypoAscender || hhea.ascender) * 0.7),
    italicAngle: post.italicAngle || 0,
    stemV: Math.max(50, Math.round(((os2.usWeightClass || 400) / 100) * 40)),
    widths,
    cmap
  };
}

function buildCharacterMap(strings, font) {
  const map = new Map();
  let nextCid = 1;
  for (const text of strings) {
    for (const ch of text) {
      if (!map.has(ch)) {
        const codePoint = ch.codePointAt(0);
        const glyphId = font.cmap.get(codePoint) || 0;
        const width = font.widths[glyphId] || font.widths[0] || Math.round(font.unitsPerEm * 0.5);
        map.set(ch, { cid: nextCid, glyphId, codePoint, width });
        nextCid += 1;
      }
    }
  }
  return map;
}

function encodeLine(line, charMap) {
  if (!line) return '<>';
  const bytes = [];
  for (const ch of line) {
    const info = charMap.get(ch);
    const cid = info ? info.cid : 0;
    bytes.push((cid >> 8) & 0xff, cid & 0xff);
  }
  return `<${Buffer.from(bytes).toString('hex').toUpperCase()}>`;
}

function buildCidToGidMap(charMap) {
  let maxCid = 0;
  for (const info of charMap.values()) {
    if (info.cid > maxCid) maxCid = info.cid;
  }
  const buffer = Buffer.alloc((maxCid + 1) * 2);
  for (const info of charMap.values()) {
    buffer.writeUInt16BE(info.glyphId, info.cid * 2);
  }
  return { buffer, maxCid };
}

function buildWidthsArray(charMap, maxCid) {
  const widths = new Array(maxCid).fill(0);
  for (const info of charMap.values()) {
    widths[info.cid - 1] = info.width;
  }
  return widths;
}

function unicodeHex(codePoint) {
  if (codePoint <= 0xffff) {
    return codePoint.toString(16).toUpperCase().padStart(4, '0');
  }
  const value = codePoint - 0x10000;
  const high = 0xd800 + ((value >> 10) & 0x3ff);
  const low = 0xdc00 + (value & 0x3ff);
  return (
    high.toString(16).toUpperCase().padStart(4, '0') +
    low.toString(16).toUpperCase().padStart(4, '0')
  );
}

function buildToUnicode(charMap) {
  const entries = Array.from(charMap.values()).sort((a, b) => a.cid - b.cid);
  const lines = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def',
    '/CMapName /BackofficeUnicode def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange'
  ];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    chunk.forEach((entry) => {
      const cidHex = entry.cid.toString(16).toUpperCase().padStart(4, '0');
      lines.push(`<${cidHex}> <${unicodeHex(entry.codePoint)}>`);
    });
    lines.push('endbfchar');
  }
  lines.push('endcmap');
  lines.push('CMapName currentdict /CMap defineresource pop');
  lines.push('end');
  lines.push('end');
  return Buffer.from(lines.join('\n'), 'utf8');
}

function buildContentStream(encodedTitle, encodedBodyLines) {
  const lines = [];
  const startY = 780;
  lines.push('BT');
  lines.push('/F1 20 Tf');
  lines.push(`1 0 0 1 56 ${startY} Tm`);
  lines.push(`${encodedTitle} Tj`);
  lines.push('/F1 12 Tf');
  lines.push('18 TL');
  let first = true;
  encodedBodyLines.forEach((encodedLine) => {
    if (first) {
      lines.push('0 -24 Td');
      first = false;
    } else {
      lines.push('T*');
    }
    if (encodedLine === '<>') {
      lines.push('<> Tj');
    } else {
      lines.push(`${encodedLine} Tj`);
    }
  });
  lines.push('ET');
  const content = lines.join('\n') + '\n';
  const buffer = Buffer.from(content, 'utf8');
  return Buffer.concat([
    Buffer.from(`<< /Length ${buffer.length} >>\nstream\n`, 'ascii'),
    buffer,
    Buffer.from('endstream\n', 'ascii')
  ]);
}

function assemblePdf({
  fontName,
  fontBuffer,
  fontMetrics,
  widths,
  defaultWidth,
  cidToGid,
  toUnicode,
  contentStream
}) {
  const header = Buffer.from('%PDF-1.7\n', 'ascii');
  const objects = [];
  const offsets = [0];
  let currentOffset = header.length;

  function addObject(content) {
    const index = objects.length + 1;
    let buffer;
    if (Buffer.isBuffer(content)) {
      buffer = Buffer.concat([
        Buffer.from(`${index} 0 obj\n`, 'ascii'),
        content,
        Buffer.from('\nendobj\n', 'ascii')
      ]);
    } else {
      buffer = Buffer.from(`${index} 0 obj\n${content}\nendobj\n`, 'utf8');
    }
    offsets[index] = currentOffset;
    objects.push(buffer);
    currentOffset += buffer.length;
  }

  const fontFileStream = Buffer.concat([
    Buffer.from(`<< /Length ${fontBuffer.length} >>\nstream\n`, 'ascii'),
    fontBuffer,
    Buffer.from('\nendstream\n', 'ascii')
  ]);

  const cidToGidStream = Buffer.concat([
    Buffer.from(`<< /Length ${cidToGid.buffer.length} >>\nstream\n`, 'ascii'),
    cidToGid.buffer,
    Buffer.from('\nendstream\n', 'ascii')
  ]);

  const toUnicodeStream = Buffer.concat([
    Buffer.from(`<< /Length ${toUnicode.length} >>\nstream\n`, 'ascii'),
    toUnicode,
    Buffer.from('\nendstream\n', 'ascii')
  ]);

  const widthsString = widths.map((w) => String(w)).join(' ');
  const fontMatrixScale = (1 / fontMetrics.unitsPerEm).toFixed(8);

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 8 0 R >> >> >>');
  addObject(contentStream);
  addObject(
    `<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /Ascent ${fontMetrics.ascender} /Descent ${fontMetrics.descender} /CapHeight ${fontMetrics.capHeight} /ItalicAngle ${fontMetrics.italicAngle} /StemV ${fontMetrics.stemV} /FontBBox [${fontMetrics.bbox.join(' ')}] /FontFile2 6 0 R >>`
  );
  addObject(fontFileStream);
  addObject(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${fontName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW ${defaultWidth} /W [1 [${widthsString}]] /CIDToGIDMap 10 0 R /FontMatrix [${fontMatrixScale} 0 0 ${fontMatrixScale} 0 0] >>`
  );
  addObject(
    `<< /Type /Font /Subtype /Type0 /BaseFont /${fontName} /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 9 0 R >>`
  );
  addObject(toUnicodeStream);
  addObject(cidToGidStream);

  const body = Buffer.concat(objects);
  const xrefStart = header.length + body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    const pos = offsets[i] || 0;
    xref += `${String(pos).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.concat([
    header,
    body,
    Buffer.from(xref, 'ascii'),
    Buffer.from(trailer, 'ascii')
  ]);
}

function createWeeklyPdf(snapshot) {
  const fontBuffer = getOpenSansSemiboldFont();
  const font = parseFont(fontBuffer);
  const title = 'Relatório Semanal';
  const bodyLines = [
    `Período: ${snapshot.range.from} a ${snapshot.range.to}`,
    `Unidades disponíveis: ${snapshot.units}`,
    '',
    `Ocupação: ${snapshot.kpis.occupancy != null ? (snapshot.kpis.occupancy * 100).toFixed(2) + '%' : '—'}`,
    `ADR: ${snapshot.kpis.adr != null ? `€${snapshot.kpis.adr.toFixed(2)}` : '—'}`,
    `RevPAR: ${snapshot.kpis.revpar != null ? `€${snapshot.kpis.revpar.toFixed(2)}` : '—'}`,
    `Receita: ${snapshot.kpis.revenue != null ? `€${snapshot.kpis.revenue.toFixed(2)}` : '—'}`,
    `Reservas confirmadas: ${snapshot.kpis.reservations}`,
    `Noites ocupadas: ${snapshot.nights.occupied}`,
    `Noites disponíveis: ${snapshot.nights.available}`
  ];
  const allStrings = [title, ...bodyLines];
  const charMap = buildCharacterMap(allStrings, font);
  const encodedTitle = encodeLine(title, charMap);
  const encodedBody = bodyLines.map((line) => encodeLine(line, charMap));
  const cidToGid = buildCidToGidMap(charMap);
  const widths = buildWidthsArray(charMap, cidToGid.maxCid);
  const toUnicode = buildToUnicode(charMap);
  const defaultWidth = widths.find((w) => w > 0) || Math.round(font.unitsPerEm * 0.5);
  const contentStream = buildContentStream(encodedTitle, encodedBody);

  return assemblePdf({
    fontName: 'OpenSansSemibold',
    fontBuffer,
    fontMetrics: font,
    widths,
    defaultWidth,
    cidToGid,
    toUnicode,
    contentStream
  });
}

module.exports = { createWeeklyPdf };
