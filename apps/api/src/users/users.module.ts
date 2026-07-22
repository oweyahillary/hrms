import { Module } from '@nestjs/common';
import { UsersController, RolesController } from './users.controller';
import { UsersService } from './users.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // PasswordService for the temp-password bootstrap
  controllers: [UsersController, RolesController],
  providers: [UsersService],
})
export class UsersModule {}
