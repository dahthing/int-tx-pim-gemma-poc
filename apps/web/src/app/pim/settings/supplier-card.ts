import { Component, OnInit, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation } from '@tanstack/angular-query-experimental';
import { supplierEnvironmentSchema, updateSupplierRequestSchema, zodValidator, type SupplierSettings } from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';

/**
 * One supplier. The token field is WRITE-ONLY (NFR-03): it is never prefilled, the API only reports
 * `credentialsConfigured`, and it is cleared after every save. Leaving it blank keeps the stored credentials.
 */
@Component({
  selector: 'app-supplier-card',
  imports: [ReactiveFormsModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatInputModule],
  template: `
    <section data-testid="supplier-card" class="mb-4 rounded border p-3">
      <h3 class="font-medium">
        {{ supplier().code }}
        <mat-chip data-testid="supplier-configured">{{ supplier().credentialsConfigured ? 'Configured' : 'Not configured' }}</mat-chip>
      </h3>
      <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-wrap items-end gap-3">
        <mat-form-field subscriptSizing="dynamic"><mat-label>Name</mat-label><input matInput formControlName="name" data-testid="supplier-name-input" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Environment</mat-label>
          <select matNativeControl formControlName="environment" data-testid="supplier-environment-select">
            @for (e of environments; track e) { <option [value]="e">{{ e }}</option> }
          </select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Base URL</mat-label><input matInput formControlName="baseUrl" data-testid="supplier-baseurl-input" /></mat-form-field>
        <div formGroupName="credentials">
          <mat-form-field subscriptSizing="dynamic">
            <mat-label>New API token (write-only)</mat-label>
            <input matInput type="password" autocomplete="new-password" formControlName="token" data-testid="supplier-token-credential" />
          </mat-form-field>
        </div>
        <button mat-flat-button type="submit" data-testid="supplier-save-button" [disabled]="saving()">Save</button>
        <button mat-stroked-button type="button" data-testid="supplier-test-button" (click)="test.mutate()">Test connection</button>
      </form>
      @if (submitted() && form.invalid) { <p class="text-red-600" data-testid="supplier-error">{{ messages(form.errors).join(', ') }}</p> }
      @if (error(); as err) { <p class="text-red-600">{{ err }}</p> }
      @if (test.data(); as t) { <p data-testid="supplier-test-result">{{ t.ok ? 'Connection OK' + (t.accountName ? ' (' + t.accountName + ')' : '') : 'Failed: ' + (t.message ?? t.reason) }}</p> }
    </section>
  `,
})
export class SupplierCard implements OnInit {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly messages = zodMessages;
  protected readonly environments = supplierEnvironmentSchema.options;

  readonly supplier = input.required<SupplierSettings>();

  protected form = this.formBuilder.nonNullable.group({ name: [''], environment: ['staging'], baseUrl: [''], credentials: this.formBuilder.nonNullable.group({ token: [''] }) });
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  ngOnInit(): void {
    const s = this.supplier();
    this.form = this.formBuilder.nonNullable.group(
      {
        name: [s.name],
        environment: [s.environment as string],
        baseUrl: [s.baseUrl ?? ''],
        credentials: this.formBuilder.nonNullable.group({ token: [''] }),
      },
      { validators: zodValidator(formSchema(updateSupplierRequestSchema)) },
    );
  }

  protected readonly update = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof updateSupplierRequestSchema.parse>) => this.api.updateSupplier(this.supplier().id, body),
    onSuccess: () => {
      this.form.controls.credentials.reset();
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'settings'] });
    },
    onError: (e: Error) => this.error.set(errorMessage(e)),
    onSettled: () => this.saving.set(false),
  }));

  protected readonly test = injectMutation(() => ({ mutationFn: () => this.api.testSupplier(this.supplier().id) }));

  protected submit(): void {
    this.submitted.set(true);
    this.error.set(null);
    if (this.form.invalid || this.saving()) return;
    this.saving.set(true);
    this.update.mutate(updateSupplierRequestSchema.parse(blankToUndefined(this.form.getRawValue())));
  }
}
