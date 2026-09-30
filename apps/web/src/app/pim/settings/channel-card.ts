import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation } from '@tanstack/angular-query-experimental';
import { updateChannelRequestSchema, zodValidator, type ChannelSettings } from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';

/**
 * One channel. Credentials are WRITE-ONLY (NFR-03): never prefilled, only `credentialsConfigured` is shown.
 * `settings` (non-secret: language, carrier mapping, stock buffer, ...) is edited as JSON.
 */
@Component({
  selector: 'app-channel-card',
  imports: [ReactiveFormsModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <section data-testid="channel-card" class="mb-4 rounded border p-3">
      <h3 class="font-medium">
        {{ channel().code }}
        <mat-chip data-testid="channel-configured">{{ channel().credentialsConfigured ? 'Configured' : 'Not configured' }}</mat-chip>
      </h3>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-wrap items-end gap-3">
        <mat-form-field subscriptSizing="dynamic"><mat-label>Name</mat-label><input matInput formControlName="name" data-testid="channel-name-input" /></mat-form-field>
        <mat-form-field class="w-96">
          <mat-label>Settings JSON (incl. carrier mapping)</mat-label>
          <textarea matInput rows="3" formControlName="settingsJson" data-testid="channel-settings-input"></textarea>
        </mat-form-field>
        <div formGroupName="credentials" class="flex flex-wrap gap-3">
          @if (channel().code === 'prestashop9') {
            <div formGroupName="adminApi" class="flex gap-3">
              <mat-form-field subscriptSizing="dynamic"><mat-label>Admin API client id (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="clientId" data-testid="channel-adminapi-id-credential" /></mat-form-field>
              <mat-form-field subscriptSizing="dynamic"><mat-label>Admin API client secret (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="clientSecret" data-testid="channel-adminapi-secret-credential" /></mat-form-field>
            </div>
            <div formGroupName="webservice">
              <mat-form-field subscriptSizing="dynamic"><mat-label>Webservice key (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="key" data-testid="channel-webservice-key-credential" /></mat-form-field>
            </div>
          } @else {
            <mat-form-field subscriptSizing="dynamic"><mat-label>App key (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="appKey" data-testid="channel-appkey-credential" /></mat-form-field>
            <mat-form-field subscriptSizing="dynamic"><mat-label>App secret (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="appSecret" data-testid="channel-appsecret-credential" /></mat-form-field>
            <mat-form-field subscriptSizing="dynamic"><mat-label>Access token (write-only)</mat-label><input matInput type="password" autocomplete="new-password" formControlName="accessToken" data-testid="channel-accesstoken-credential" /></mat-form-field>
          }
        </div>
        <button mat-flat-button type="submit" data-testid="channel-save-button" [disabled]="saving()">Save</button>
        <button mat-stroked-button type="button" data-testid="channel-test-button" (click)="test.mutate()">Test connection</button>
      </form>
      @if (submitted() && form.invalid) { <p class="text-red-600" data-testid="channel-error">{{ messages(form.errors).join(', ') }}</p> }
      @if (error(); as err) { <p class="text-red-600" data-testid="channel-error">{{ err }}</p> }
      @if (test.data(); as t) { <p data-testid="channel-test-result">{{ t.ok ? 'Connection OK' : 'Failed: ' + (t.message ?? t.reason) }}</p> }
    </section>
  `,
})
export class ChannelCard implements OnInit {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly messages = zodMessages;

  readonly channel = input.required<ChannelSettings>();

  protected form: FormGroup = this.formBuilder.group({});
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const c = this.channel();
    const credentials =
      c.code === 'prestashop9'
        ? this.formBuilder.nonNullable.group({
            adminApi: this.formBuilder.nonNullable.group({ clientId: [''], clientSecret: [''] }),
            webservice: this.formBuilder.nonNullable.group({ key: [''] }),
          })
        : this.formBuilder.nonNullable.group({ appKey: [''], appSecret: [''], accessToken: [''] });
    this.form = this.formBuilder.nonNullable.group(
      { name: [c.name ?? ''], settingsJson: [JSON.stringify(c.settings)], credentials },
      { validators: zodValidator(formSchema(updateChannelRequestSchema)) },
    );
  }

  protected readonly update = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof updateChannelRequestSchema.parse>) => this.api.updateChannel(this.channel().id, body),
    onSuccess: () => {
      this.form.get('credentials')?.reset();
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'settings'] });
    },
    onError: (e: Error) => this.error.set(errorMessage(e)),
    onSettled: () => this.saving.set(false),
  }));

  protected readonly test = injectMutation(() => ({ mutationFn: () => this.api.testChannel(this.channel().id) }));

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid || this.saving()) return;

    const { settingsJson, ...rest } = this.form.getRawValue() as { settingsJson: string } & Record<string, unknown>;
    let settings: unknown;
    try {
      settings = JSON.parse(settingsJson || '{}');
    } catch {
      this.error.set('Settings must be valid JSON.');
      return;
    }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      this.error.set('Settings must be a JSON object.');
      return;
    }
    const parsed = updateChannelRequestSchema.safeParse({ ...(blankToUndefined(rest) as object), settings });
    if (!parsed.success) {
      this.error.set(parsed.error.issues.map((i) => i.message).join(', '));
      return;
    }
    this.saving.set(true);
    this.update.mutate(parsed.data);
  }
}
