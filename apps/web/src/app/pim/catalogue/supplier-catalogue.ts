import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation, injectQuery, keepPreviousData } from '@tanstack/angular-query-experimental';
import { errorMessage } from '../forms';
import { PimApi, type ListParams } from '../pim-api';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-supplier-catalogue',
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Supplier catalogue</h1>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <form class="flex items-center gap-2" (submit)="$event.preventDefault(); applySearch()">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Search</mat-label>
          <input matInput data-testid="search-input" [formControl]="searchControl" />
        </mat-form-field>
        <button mat-stroked-button type="submit" data-testid="search-button">Search</button>
      </form>

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Department</mat-label>
        <select matNativeControl data-testid="department-select" [value]="department() ?? ''" (change)="setDepartment($any($event.target).value)">
          <option value="">All</option>
          @for (name of facets.data()?.departments ?? []; track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
      </mat-form-field>

      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Family</mat-label>
        <select matNativeControl data-testid="family-select" [value]="family() ?? ''" (change)="setFamily($any($event.target).value)">
          <option value="">All</option>
          @for (name of facets.data()?.families ?? []; track name) {
            <option [value]="name">{{ name }}</option>
          }
        </select>
      </mat-form-field>

      <button
        mat-flat-button
        type="button"
        data-testid="bulk-add-button"
        [disabled]="selectedCount() === 0 || bulkAdd.isPending()"
        (click)="addSelected()"
      >
        <mat-icon>add_circle</mat-icon> Add to Gemma ({{ selectedCount() }})
      </button>
    </div>

    @if (bulkAdd.data(); as result) {
      <p data-testid="bulk-result" class="mb-2">
        Added {{ okCount(result.results) }} of {{ result.results.length }} selected products.
      </p>
    }
    @if (bulkAdd.isError()) {
      <p class="mb-2 text-red-600">{{ message(bulkAdd.error()) }}</p>
    }
    @if (products.isError()) {
      <p class="text-red-600" data-testid="catalogue-error">{{ message(products.error()) }}</p>
    }

    <table class="w-full text-left">
      <thead>
        <tr><th></th><th>Name</th><th>EAN</th><th>Department / family</th><th>Stock</th><th>Cost</th><th>Status</th></tr>
      </thead>
      <tbody>
        @for (item of products.data()?.items ?? []; track item.id) {
          <tr data-testid="catalogue-row">
            <td>
              <mat-checkbox
                data-testid="row-select"
                [disabled]="item.inAssortment"
                [checked]="selected().has(item.id)"
                (change)="toggle(item.id, $event.checked)"
              />
            </td>
            <td>{{ item.name }}</td>
            <td>{{ item.ean }}</td>
            <td>{{ item.department }} / {{ item.family }}</td>
            <td>{{ item.stock }}</td>
            <td>{{ item.costPrice }} {{ item.currency }}</td>
            <td>{{ item.inAssortment ? 'In Gemma' : item.status }}</td>
          </tr>
        }
      </tbody>
    </table>

    <div class="mt-3 flex items-center gap-3">
      <button mat-button type="button" data-testid="prev-page" [disabled]="skip() === 0" (click)="goTo(skip() - pageSize)">Previous</button>
      <span>{{ from() }}-{{ to() }} of {{ total() }}</span>
      <button mat-button type="button" data-testid="next-page" [disabled]="to() >= total()" (click)="goTo(skip() + pageSize)">Next</button>
    </div>
  `,
})
export class SupplierCatalogue {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  protected readonly message = errorMessage;
  protected readonly pageSize = PAGE_SIZE;

  protected readonly searchControl = new FormControl('', { nonNullable: true });
  protected readonly search = signal<string | undefined>(undefined);
  protected readonly department = signal<string | undefined>(undefined);
  protected readonly family = signal<string | undefined>(undefined);
  protected readonly skip = signal(0);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly selectedCount = computed(() => this.selected().size);

  /** Exactly what is sent to `GET /supplier-products`: unset filters are absent. */
  private readonly params = computed<ListParams>(() => ({
    skip: this.skip(),
    take: PAGE_SIZE,
    ...(this.search() ? { search: this.search() } : {}),
    ...(this.department() ? { department: this.department() } : {}),
    ...(this.family() ? { family: this.family() } : {}),
  }));

  protected readonly products = injectQuery(() => ({
    queryKey: ['pim', 'supplier-products', this.params()],
    queryFn: () => this.api.supplierProducts(this.params()),
    placeholderData: keepPreviousData,
  }));

  protected readonly facets = injectQuery(() => ({
    queryKey: ['pim', 'supplier-products', 'facets', this.department() ?? null],
    queryFn: () => this.api.supplierProductFacets(this.department() ? { department: this.department() } : {}),
    placeholderData: keepPreviousData,
  }));

  protected readonly bulkAdd = injectMutation(() => ({
    mutationFn: (ids: string[]) => this.api.bulkAdd({ supplierProductIds: ids }),
    onSuccess: () => {
      this.selected.set(new Set());
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'supplier-products'] });
    },
  }));

  protected readonly total = computed(() => this.products.data()?.meta.total ?? 0);
  protected readonly from = computed(() => (this.total() === 0 ? 0 : this.skip() + 1));
  protected readonly to = computed(() => Math.min(this.skip() + PAGE_SIZE, this.total()));

  protected applySearch(): void {
    this.search.set(this.searchControl.value.trim() || undefined);
    this.skip.set(0);
  }

  protected setDepartment(value: string): void {
    this.department.set(value || undefined);
    this.family.set(undefined);
    this.skip.set(0);
  }

  protected setFamily(value: string): void {
    this.family.set(value || undefined);
    this.skip.set(0);
  }

  protected goTo(skip: number): void {
    this.skip.set(Math.max(0, skip));
  }

  protected toggle(id: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  protected addSelected(): void {
    if (this.selectedCount() === 0 || this.bulkAdd.isPending()) return;
    this.bulkAdd.mutate([...this.selected()]);
  }

  protected okCount(results: { ok: boolean }[]): number {
    return results.filter((r) => r.ok).length;
  }
}
