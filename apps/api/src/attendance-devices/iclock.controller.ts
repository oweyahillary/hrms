import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { AttendanceDevicesService } from './attendance-devices.service';

/**
 * ZKTeco ADMS/iClock push protocol — plain HTTP, identified by device serial
 * number (SN) query param only, no cryptographic auth. OUR security model is
 * the device registry: resolveActiveDevice() is the sole gate, an unknown or
 * inactive SN gets HTTP 410 and nothing is stored or read.
 *
 * Deliberately NOT under the global 'api' prefix (see main.ts) — real ZK
 * terminals hardcode this path in firmware; only the server host/port is
 * configurable on the device.
 *
 * Response bodies are plain text per the protocol (not JSON) — devices parse
 * fixed line formats, not JSON. The handshake's config block (Stamp/Delay/
 * TransFlag/etc.) is a commonly-documented minimal reply, NOT verified
 * against this pilot's actual physical unit — flagged in the summary; get a
 * packet capture from the real device before trusting it in production,
 * same caution already applied to the ZKTeco CSV export headers.
 */
@Controller('iclock')
export class IclockController {
  constructor(private readonly devices: AttendanceDevicesService) {}

  @Public()
  @Get('cdata')
  async handshake(@Query('SN') sn: string | undefined, @Res({ passthrough: true }) res: Response): Promise<string> {
    const device = sn ? await this.devices.resolveActiveDevice(sn) : null;
    if (!device) {
      res.status(410);
      return 'ERROR: unregistered or inactive device';
    }
    res.type('text/plain');
    return [
      `GET OPTION FROM: ${device.serialNumber}`,
      'Stamp=9999',
      'OpStamp=9999',
      'ErrorDelay=30',
      'Delay=30',
      'TransFlag=1111000000',
      'Realtime=1',
      'Encrypt=0',
    ].join('\n');
  }

  /** table=ATTLOG carries punch lines in the raw-text body (see main.ts's path-scoped text parser). Other table values (OPERLOG, photos, etc.) are acknowledged but not yet processed. @HttpCode(200): a device protocol response, not a REST resource — Nest's POST default of 201 doesn't apply here (the reject branch still overrides to 410 via res.status). */
  @Public()
  @Post('cdata')
  @HttpCode(200)
  async pushData(
    @Query('SN') sn: string | undefined,
    @Query('table') table: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const device = sn ? await this.devices.resolveActiveDevice(sn) : null;
    if (!device) {
      res.status(410);
      return 'ERROR: unregistered or inactive device';
    }
    res.type('text/plain');
    if (table !== 'ATTLOG') return 'OK';
    const raw = typeof body === 'string' ? body : '';
    const count = await this.devices.ingestAttlog(device, raw);
    return `OK: ${count}`;
  }

  /** Polled by the device for remote commands (reboot, user sync, etc.) — none supported yet, always answered 'OK' (no pending commands). */
  @Public()
  @Get('getrequest')
  async getRequest(@Query('SN') sn: string | undefined, @Res({ passthrough: true }) res: Response): Promise<string> {
    const device = sn ? await this.devices.resolveActiveDevice(sn) : null;
    if (!device) {
      res.status(410);
      return 'ERROR: unregistered or inactive device';
    }
    res.type('text/plain');
    return 'OK';
  }
}
