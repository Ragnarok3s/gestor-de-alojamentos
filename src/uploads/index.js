const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
const UPLOAD_UNITS = path.join(UPLOAD_ROOT, 'units');

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function buildStorage() {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const unitId = req.params.id || req.body.unit_id;
      if (!unitId) return cb(new Error('unit_id em falta'));
      const dir = path.join(UPLOAD_UNITS, String(unitId));
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase();
      cb(null, crypto.randomBytes(8).toString('hex') + ext);
    },
  });
}

function createUploadMiddleware() {
  ensureDir(UPLOAD_ROOT);
  ensureDir(UPLOAD_UNITS);
  const storage = buildStorage();
  return multer({
    storage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype || '');
      cb(ok ? null : new Error('Tipo de imagem inválido'), ok);
    },
  });
}

function exposeUploads(app) {
  ensureDir(UPLOAD_ROOT);
  app.use('/uploads', express.static(UPLOAD_ROOT, { fallthrough: false }));
}

module.exports = {
  UPLOAD_ROOT,
  UPLOAD_UNITS,
  ensureDir,
  createUploadMiddleware,
  exposeUploads,
};
