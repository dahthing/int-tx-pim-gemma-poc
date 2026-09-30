import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import {
  createPriceRuleRequestSchema,
  priceRoundingSchema,
  updatePriceRuleRequestSchema,
  zodValidator,
  type PriceRuleDto,
} from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';

const EMPTY_FORM = {
  channelId: '',
  priority: 0,
  condition: { category: '', costMin: '', costMax: '', tag: '' },
  markupPct: '',
  fixedAdd: '',
  rounding: 'none',
  minMarginPct: '',
  vatRate: '',
};

@Component({
  selector: 'app-price-rules',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Price rules</h1>
    <p class="mb-2 text-sm">Percentages are entered as fractions (0.5 = 50%). The first matching rule by priority wins.</p>

    <table class="mb-6 w-full text-left">
      <thead><tr><th>Priority</th><th>Channel</th><th>Conditions</th><th>Markup</th><th>Fixed add</th><th>Rounding</th><th>Min margin</th><th>VAT</th><th></th></tr></thead>
      <tbody>
        @for (rule of rules.data()?.items ?? []; track rule.id) {
          <tr data-testid="rule-row">
            <td>{{ rule.priority }}</td>
            <td>{{ channelName(rule.channelId) }}</td>
            <td>{{ conditionText(rule) }}</td>
            <td>{{ pct(rule.markupPct) }}</td>
            <td>{{ rule.fixedAdd ?? '-' }}</td>
            <td>{{ rule.rounding }}</td>
            <td>{{ pct(rule.minMarginPct) }}</td>
            <td>{{ pct(rule.vatRate) }}</td>
            <td>
              <button mat-button type="button" data-testid="edit-rule-button" (click)="edit(rule)">Edit</button>
              <button mat-button type="button" data-testid="delete-rule-button" (click)="remove.mutate(rule.id)">Delete</button>
            </td>
          </tr>
        }
      </tbody>
    </table>

    <h2 class="mb-2 text-lg font-medium">{{ editingId() ? 'Edit rule' : 'New rule' }}</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" data-testid="rule-form" class="flex flex-wrap items-end gap-3">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Channel</mat-label>
        <select matNativeControl formControlName="channelId" data-testid="channelId-select">
          <option value="">All channels</option>
          @for (ch of channels(); track ch.id) { <option [value]="ch.id">{{ ch.name ?? ch.code }}</option> }
        </select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic"><mat-label>Priority</mat-label><input matInput type="number" formControlName="priority" data-testid="priority-input" /></mat-form-field>
      <mat-form-field subscriptSizing="dynamic"><mat-label>Markup (fraction)</mat-label><input matInput formControlName="markupPct" data-testid="markupPct-input" /></mat-form-field>
      <mat-form-field subscriptSizing="dynamic"><mat-label>Fixed add</mat-label><input matInput formControlName="fixedAdd" data-testid="fixedAdd-input" /></mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Rounding</mat-label>
        <select matNativeControl formControlName="rounding" data-testid="rounding-select">
          @for (r of roundings; track r) { <option [value]="r">{{ r }}</option> }
        </select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic"><mat-label>Min margin (fraction)</mat-label><input matInput formControlName="minMarginPct" data-testid="minMarginPct-input" /></mat-form-field>
      <mat-form-field subscriptSizing="dynamic"><mat-label>VAT rate (fraction)</mat-label><input matInput formControlName="vatRate" data-testid="vatRate-input" /></mat-form-field>
      <div formGroupName="condition" class="flex gap-3">
        <mat-form-field subscriptSizing="dynamic"><mat-label>Category</mat-label><input matInput formControlName="category" data-testid="condition-category-input" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Cost min</mat-label><input matInput formControlName="costMin" data-testid="condition-costMin-input" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Cost max</mat-label><input matInput formControlName="costMax" data-testid="condition-costMax-input" /></mat-form-field>
        <mat-form-field subscriptSizing="dynamic"><mat-label>Tag</mat-label><input matInput formControlName="tag" data-testid="condition-tag-input" /></mat-form-field>
      </div>
      <button mat-flat-button type="submit" data-testid="save-rule-button" [disabled]="saving()">{{ editingId() ? 'Update rule' : 'Create rule' }}</button>
      @if (editingId()) { <button mat-button type="button" (click)="reset()">Cancel</button> }
    </form>
    @if (submitted() && form.invalid) {
      <ul class="text-red-600" data-testid="form-error">
        @for (m of messages(form.errors); track $index) { <li>{{ m }}</li> }
      </ul>
    }
    @if (serverError(); as err) { <p class="text-red-600">{{ err }}</p> }
  `,
})
export class PriceRules {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly messages = zodMessages;
  protected readonly roundings = priceRoundingSchema.options;

  protected readonly form = this.formBuilder.nonNullable.group(
    {
      channelId: [EMPTY_FORM.channelId],
      priority: [EMPTY_FORM.priority],
      condition: this.formBuilder.nonNullable.group(EMPTY_FORM.condition),
      markupPct: [EMPTY_FORM.markupPct],
      fixedAdd: [EMPTY_FORM.fixedAdd],
      rounding: [EMPTY_FORM.rounding],
      minMarginPct: [EMPTY_FORM.minMarginPct],
      vatRate: [EMPTY_FORM.vatRate],
    },
    { validators: zodValidator(formSchema(createPriceRuleRequestSchema)) },
  );

  protected readonly editingId = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);
  private busy = false;
  protected readonly saving = signal(false);

  protected readonly rules = injectQuery(() => ({
    queryKey: ['pim', 'price-rules'],
    queryFn: () => this.api.priceRules(),
  }));
  private readonly settings = injectQuery(() => ({
    queryKey: ['pim', 'settings'],
    queryFn: () => this.api.settings(),
  }));
  protected readonly channels = computed(() => this.settings.data()?.channels ?? []);

  protected readonly remove = injectMutation(() => ({
    mutationFn: (id: string) => this.api.deletePriceRule(id),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'price-rules'] }),
    onError: (e: Error) => this.serverError.set(errorMessage(e)),
  }));

  private readonly persist = injectMutation(() => ({
    mutationFn: (v: { id: string | null; raw: unknown }) =>
      v.id
        ? this.api.updatePriceRule(v.id, updatePriceRuleRequestSchema.parse(nullifyCleared(v.raw)))
        : this.api.createPriceRule(createPriceRuleRequestSchema.parse(v.raw)),
    onSuccess: () => {
      this.reset();
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'price-rules'] });
    },
    onError: (e: Error) => this.serverError.set(errorMessage(e)),
    onSettled: () => {
      this.busy = false;
      this.saving.set(false);
    },
  }));

  protected channelName(id: string | null): string {
    return id ? (this.channels().find((c) => c.id === id)?.name ?? id) : 'All';
  }

  protected conditionText(rule: PriceRuleDto): string {
    const parts = Object.entries(rule.condition).map(([k, v]) => `${k}=${v}`);
    return parts.length ? parts.join(', ') : 'any';
  }

  protected pct(fraction: string | null): string {
    return fraction === null ? '-' : `${+(Number(fraction) * 100).toFixed(2)}%`;
  }

  protected edit(rule: PriceRuleDto): void {
    this.editingId.set(rule.id);
    this.submitted.set(false);
    this.form.setValue({
      channelId: rule.channelId ?? '',
      priority: rule.priority,
      condition: {
        category: rule.condition.category ?? '',
        costMin: rule.condition.costMin ?? '',
        costMax: rule.condition.costMax ?? '',
        tag: rule.condition.tag ?? '',
      },
      markupPct: rule.markupPct ?? '',
      fixedAdd: rule.fixedAdd ?? '',
      rounding: rule.rounding,
      minMarginPct: rule.minMarginPct ?? '',
      vatRate: rule.vatRate,
    });
  }

  protected reset(): void {
    this.editingId.set(null);
    this.submitted.set(false);
    this.serverError.set(null);
    this.form.reset(EMPTY_FORM);
  }

  protected submit(): void {
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.form.invalid || this.busy) return;
    this.busy = true;
    this.saving.set(true);
    this.persist.mutate({ id: this.editingId(), raw: blankToUndefined(this.form.getRawValue()) });
  }
}

/** A PATCH omits untouched fields, so a field the user cleared must be sent as an explicit null. */
function nullifyCleared(raw: unknown): unknown {
  const body = { ...(raw as Record<string, unknown>) };
  for (const key of ['channelId', 'markupPct', 'fixedAdd', 'minMarginPct']) body[key] ??= null;
  return body;
}
