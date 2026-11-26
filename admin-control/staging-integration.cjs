'use strict';

const {readdirSync} = require('node:fs');
const {spawnSync} = require('node:child_process');
const {Pool} = require('pg');
const {checkDeployment, v11Database} = require('./v11-core.cjs');

async function verify() {
  checkDeployment(process.env);
  if (process.env.RAILWAY_SERVICE_NAME !== 'admin-web') throw Error('V11_SERVICE_REQUIRED');
  const pool = new Pool({connectionString: process.env.DATABASE_URL, connectionTimeoutMillis:3000});
  try {
    const {rows: [row]} = await pool.query('select current_database() as name');
    if (row?.name !== v11Database) throw Error('V11_DATABASE_REQUIRED');
  } finally {
    await pool.end();
  }
  const tests = readdirSync('.').filter(name => name.endsWith('.test.cjs')).sort();
  const child = spawnSync(process.execPath, ['--test','test.cjs', ...tests], {
    stdio:'inherit', env:{...process.env,DIRECTOR_TEST_DATABASE_URL:process.env.DATABASE_URL}
  });
  process.exitCode = child.status ?? 1;
}

verify().catch(error => {
  console.error('Integration tests require the isolated Railway V1.1 database:', error.code || error.name);
  process.exitCode = 1;
});
