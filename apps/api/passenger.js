'use strict';
/*
 * cPanel / Phusion Passenger startup shim.
 *
 * Set this file as the "Application startup file" in cPanel's Setup Node.js App.
 *
 * Passenger uses "reverse port binding": whatever port the app listens on is
 * ignored and replaced by a port Passenger picks. But Passenger may hand the
 * app a Unix-socket PATH in process.env.PORT, which our strict numeric env
 * validation would reject at boot. We normalise it to a number purely to
 * satisfy validation — the real bind is Passenger's, so the value is moot.
 */
if (!/^\d+$/.test(process.env.PORT || '')) {
  process.env.PORT = '3000';
}

require('./dist/main.js')
  .bootstrap()
  .catch((err) => {
    // Surfaces in the Passenger log configured in the cPanel Node.js app.
    console.error('Fatal: HRMS API failed to start');
    console.error(err);
    process.exit(1);
  });
