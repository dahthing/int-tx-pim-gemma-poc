import { Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation } from '@tanstack/angular-query-experimental';
import { manualTrackingRequestSchema, zodValidator } from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';

/** FR-ORD-002: carrier + tracking number for a `supplier_submitted` order; saving triggers `pushShipment`. */
@Component({
  selector: 'app-manual-tracking-form',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="flex flex-wrap items-end gap-3" data-testid="tracking-form">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Carrier code</mat-label>
        <input matInput formControlName="carrierCode" data-testid="carrier-input" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Carrier name (optional)</mat-label>
        <input matInput formControlName="carrierName" data-testid="carrier-name-input" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Tracking number</mat-label>
        <input matInput formControlName="trackingNumber" data-testid="tracking-input" />
      </mat-form-field>
      <button mat-flat-button type="submit" data-testid="tracking-submit" [disabled]="submitting()">Save tracking</button>
    </form>
    @if (submitted() && form.invalid) {
      <ul class="text-red-600" data-testid="tracking-form-error">
        @for (m of messages(form.errors); track $index) { <li>{{ m }}</li> }
      </ul>
    }
    @if (serverError(); as err) { <p class="text-red-600">{{ err }}</p> }
    @if (result(); as r) {
      <p data-testid="tracking-result">
        Shipment {{ r.shipmentId }} saved{{ r.idempotent ? ' (already existed)' : '' }};
        {{ r.pushed ? 'pushed to the channel.' : 'not pushed: ' + (r.error ?? 'unknown error') }}
      </p>
    }
  `,
})
export class ManualTrackingForm {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly messages = zodMessages;

  readonly orderId = input.required<string>();

  protected readonly form = this.formBuilder.nonNullable.group(
    { carrierCode: [''], carrierName: [''], trackingNumber: [''] },
    { validators: zodValidator(formSchema(manualTrackingRequestSchema)) },
  );
  protected readonly submitted = signal(false);
  protected readonly submitting = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly mutation = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof manualTrackingRequestSchema.parse>) => this.api.submitTracking(this.orderId(), body),
    onSuccess: (r) => {
      this.result.set(r);
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'order', this.orderId()] });
    },
    onError: (e: Error) => this.serverError.set(errorMessage(e)),
    onSettled: () => this.submitting.set(false),
  }));
  protected readonly result = signal<{ shipmentId: string; pushed: boolean; idempotent: boolean; error?: string } | null>(null);

  protected submit(): void {
    this.submitted.set(true);
    // `submitting` flips synchronously, so a second click before the request settles is ignored (no double submit).
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.serverError.set(null);
    this.mutation.mutate(manualTrackingRequestSchema.parse(blankToUndefined(this.form.getRawValue())));
  }
}
