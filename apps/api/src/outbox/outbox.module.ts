import { Module } from '@nestjs/common';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxRepository } from './outbox.repository';

@Module({ providers: [OutboxRepository, OutboxPublisherService], exports: [OutboxRepository, OutboxPublisherService] })
export class OutboxModule {}
