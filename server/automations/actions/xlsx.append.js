const path = require('node:path');
const fs = require('node:fs');

module.exports = async function xlsxAppendAction(action = {}, payload = {}, context = {}) {
  const { ExcelJS, ensureDir = () => {}, paths = {} } = context;
  if (!ExcelJS) {
    throw new Error('ExcelJS não está disponível para automações.');
  }

  const file = typeof action.file === 'string' ? action.file.trim() : '';
  if (!file) {
    throw new Error('É necessário indicar o ficheiro Excel de destino.');
  }
  const sheetName = typeof action.sheet === 'string' && action.sheet.trim().length
    ? action.sheet.trim()
    : 'Registos';

  const columns = Array.isArray(action.columns) ? action.columns : [];
  if (!columns.length) {
    throw new Error('Nenhuma coluna configurada para append em Excel.');
  }

  const baseDir = paths && paths.exports ? paths.exports : path.join(process.cwd(), 'exports');
  ensureDir(baseDir);

  const targetPath = path.isAbsolute(file) ? file : path.join(baseDir, file);
  ensureDir(path.dirname(targetPath));

  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(targetPath)) {
    await workbook.xlsx.readFile(targetPath);
  }

  const worksheet = workbook.getWorksheet(sheetName) || workbook.addWorksheet(sheetName);

  const values = columns.map(column => {
    if (column && typeof column === 'object' && column.path) {
      const pathKeys = String(column.path)
        .split('.')
        .filter(Boolean);
      let current = payload;
      for (const key of pathKeys) {
        if (current && Object.prototype.hasOwnProperty.call(current, key)) {
          current = current[key];
        } else {
          current = undefined;
          break;
        }
      }
      if (current === undefined && column.default !== undefined) {
        return column.default;
      }
      return current;
    }
    if (typeof column === 'string') {
      return payload[column];
    }
    return '';
  });

  worksheet.addRow(values);
  await workbook.xlsx.writeFile(targetPath);

  return { file: targetPath, sheet: sheetName, columns: values.length };
};
