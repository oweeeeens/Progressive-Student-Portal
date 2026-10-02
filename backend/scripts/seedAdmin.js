// Bootstraps the very first admin account. Needed because /api/auth/register
// requires an admin to already be logged in — without this script there
// would be no way to create that first account. Safe to re-run: it's a
// no-op if an admin already exists.
require('dotenv').config();

const { pool } = require('../config/db');
const userModel = require('../models/userModel');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const fullName = process.env.ADMIN_FULL_NAME || 'System Administrator';

  if (!email || !password) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env before running this script.');
  }

  const existing = await userModel.findByEmail(email);
  if (existing) {
    console.log(`Admin account for ${email} already exists — nothing to do.`);
    return;
  }

  await userModel.createUser({ email, password, fullName, role: 'admin' });
  console.log(`Created admin account for ${email}.`);
}

seedAdmin()
  .catch((error) => {
    console.error('Failed to seed admin account:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
