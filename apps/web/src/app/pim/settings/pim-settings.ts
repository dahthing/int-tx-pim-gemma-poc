import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import {
  channelCodeSchema,
  createChannelRequestSchema,
  createSupplierRequestSchema,
  supplierEnvironmentSchema,
  zodValidator,
} from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';
import { ChannelCard } from './channel-card';
import { SupplierCard } from './supplier-card';

@Component({
  selector: 'app-pim-settings',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, SupplierCard, ChannelCard],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Settings</h1>
    @if (settings.isError()) { <p class="text-red-600">{{ message(settings.error()) }}</p> }

    @if (settings.data(); as s) {
      <h2 class="mb-2 text-lg font-medium">Tenant defaults (read-only)</h2>
      <dl class="mb-6 grid grid-cols-2 gap-1" data-testid="tenant-defaults">
        <dt>Default e-mail</dt><dd>{{ s.tenantDefaults.defaultEmail ?? '-' }}</dd>
        <dt>Default phone</dt><dd>{{ s.tenantDefaults.defaultPhone ?? '-' }}</dd>
        <dt>Minimum margin</dt><dd>{{ s.tenantDefaults.minMargin }}</dd>
        <dt>VAT rate</dt><dd>{{ s.tenantDefaults.vatRate }}</dd>
      </dl>

      <h2 class="mb-2 text-lg font-medium">Suppliers</h2>
      @for (supplier of s.suppliers; track supplier.id) { <app-supplier-card [supplier]="supplier" /> }

      <h3 class="mt-2 font-medium">Add supplier</h3>
      <form [formGroup]="supplierForm" (ngSubmit)="addSupplier()" class="mb-6 flex flex-wrap items-end gap-3">
        <mat-form-field subscriptSizing="dynamic"><mat-label>Code</mat-label><input matInput formControlName="code" data-testid="new-supplier-code" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Name</mat-label><input matInput formControlName="name" data-testid="new-supplier-name" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Environment</mat-label>
          <select matNativeControl formControlName="environment">
            @for (e of environments; track e) { <option [value]="e">{{ e }}</option> }
          </select>
        </mat-form-field>
        <div formGroupName="credentials">
          <mat-form-field subscriptSizing="dynamic"><mat-label>API token (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="token" data-testid="new-supplier-token-credential" /></mat-form-field>
        </div>
        <button mat-flat-button type="submit" data-testid="add-supplier-button">Add supplier</button>
        @if (supplierSubmitted() && supplierForm.invalid) { <span class="text-red-600">{{ messages(supplierForm.errors).join(', ') }}</span> }
      </form>

      <h2 class="mb-2 text-lg font-medium">Channels</h2>
      @for (channel of s.channels; track channel.id) { <app-channel-card [channel]="channel" /> }

      <h3 class="mt-2 font-medium">Add channel</h3>
      <form [formGroup]="channelForm" (ngSubmit)="addChannel()" class="flex flex-wrap items-end gap-3">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Type</mat-label>
          <select matNativeControl formControlName="code" data-testid="new-channel-code">
            @for (c of channelCodes; track c) { <option [value]="c">{{ c }}</option> }
          </select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Name</mat-label><input matInput formControlName="name" data-testid="new-channel-name" /></mat-form-field>
        <div formGroupName="credentials" class="flex flex-wrap gap-3">
          <div formGroupName="webservice"><mat-form-field subscriptSizing="dynamic"><mat-label>PrestaShop webservice key</mat-label><input matInput type="password" autocomplete="new-password" formControlName="key" data-testid="new-channel-webservice-credential" /></mat-form-field></div>
          <mat-form-field subscriptSizing="dynamic"><mat-label>Temu app key</mat-label><input matInput type="password" autocomplete="new-password" formControlName="appKey" data-testid="new-channel-appkey-credential" /></mat-form-field>
          <mat-form-field subscriptSizing="dynamic"><mat-label>Temu app secret</mat-label><input matInput type="password" autocomplete="new-password" formControlName="appSecret" data-testid="new-channel-appsecret-credential" /></mat-form-field>
          <mat-form-field subscriptSizing="dynamic"><mat-label>Temu access token</mat-label><input matInput type="password" autocomplete="new-password" formControlName="accessToken" data-testid="new-channel-accesstoken-credential" /></mat-form-field>
        </div>
        <button mat-flat-button type="submit" data-testid="add-channel-button">Add channel</button>
        @if (channelSubmitted() && channelForm.invalid) { <span class="text-red-600">{{ messages(channelForm.errors).join(', ') }}</span> }
      </form>
      @if (createError(); as err) { <p class="mt-2 text-red-600">{{ err }}</p> }
    }
  `,
})
export class PimSettings {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly message = errorMessage;
  protected readonly messages = zodMessages;
  protected readonly environments = supplierEnvironmentSchema.options;
  protected readonly channelCodes = channelCodeSchema.options;

  protected readonly settings = injectQuery(() => ({
    queryKey: ['pim', 'settings'],
    queryFn: () => this.api.settings(),
  }));

  protected readonly supplierForm = this.formBuilder.nonNullable.group(
    { code: [''], name: [''], environment: ['staging'], credentials: this.formBuilder.nonNullable.group({ token: [''] }) },
    { validators: zodValidator(formSchema(createSupplierRequestSchema)) },
  );
  protected readonly channelForm = this.formBuilder.nonNullable.group(
    {
      code: ['prestashop9'],
      name: [''],
      credentials: this.formBuilder.nonNullable.group({
        webservice: this.formBuilder.nonNullable.group({ key: [''] }),
        appKey: [''],
        appSecret: [''],
        accessToken: [''],
      }),
    },
    { validators: zodValidator(formSchema(createChannelRequestSchema)) },
  );
  protected readonly supplierSubmitted = signal(false);
  protected readonly channelSubmitted = signal(false);
  protected readonly createError = signal<string | null>(null);

  private readonly createSupplier = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof createSupplierRequestSchema.parse>) => this.api.createSupplier(body),
    onSuccess: () => {
      this.supplierForm.reset({ environment: 'staging' });
      this.supplierSubmitted.set(false);
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'settings'] });
    },
    onError: (e: Error) => this.createError.set(errorMessage(e)),
  }));

  private readonly createChannel = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof createChannelRequestSchema.parse>) => this.api.createChannel(body),
    onSuccess: () => {
      this.channelForm.reset({ code: 'prestashop9' });
      this.channelSubmitted.set(false);
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'settings'] });
    },
    onError: (e: Error) => this.createError.set(errorMessage(e)),
  }));

  protected addSupplier(): void {
    this.supplierSubmitted.set(true);
    this.createError.set(null);
    if (this.supplierForm.invalid || this.createSupplier.isPending()) return;
    this.createSupplier.mutate(createSupplierRequestSchema.parse(blankToUndefined(this.supplierForm.getRawValue())));
  }

  protected addChannel(): void {
    this.channelSubmitted.set(true);
    this.createError.set(null);
    if (this.channelForm.invalid || this.createChannel.isPending()) return;
    this.createChannel.mutate(createChannelRequestSchema.parse(blankToUndefined(this.channelForm.getRawValue())));
  }
}
