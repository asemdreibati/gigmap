import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createProfileSchema,
  registerPushTokenSchema,
  updateProfileSchema,
  type CreateProfileInput,
  type PublicUser,
  type RegisterPushTokenInput,
  type SelfUser,
  type UpdateProfileInput,
} from '@gigmap/shared';

import { AllowNoProfile, CurrentUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/guards/authenticated-user';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post('me')
  @AllowNoProfile()
  createProfile(
    @CurrentUser() auth: AuthenticatedUser,
    @Body(new ZodValidationPipe(createProfileSchema)) body: CreateProfileInput,
  ): Promise<SelfUser> {
    return this.users.createProfile(auth, body);
  }

  @Get('me')
  findSelf(@CurrentUser('id') id: string): Promise<SelfUser> {
    return this.users.findSelf(id);
  }

  @Patch('me')
  update(
    @CurrentUser() auth: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<SelfUser> {
    return this.users.update(auth, body);
  }

  @Post('me/push-tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerPushToken(
    @CurrentUser('id') id: string,
    @Body(new ZodValidationPipe(registerPushTokenSchema)) body: RegisterPushTokenInput,
  ): Promise<void> {
    return this.users.registerPushToken(id, body);
  }

  @Delete('me/push-tokens/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePushToken(
    @CurrentUser('id') id: string,
    @Param('token') token: string,
  ): Promise<void> {
    return this.users.removePushToken(id, token);
  }

  /** Public profile — used by the employer's applicant list and vice versa. */
  @Get(':id')
  findPublic(@Param('id', ParseUUIDPipe) id: string): Promise<PublicUser> {
    return this.users.findPublic(id);
  }
}
