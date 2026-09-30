import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { QueryClient, injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import {
  createCategoryRequestSchema,
  mapSupplierPathRequestSchema,
  zodValidator,
  type ChannelSettings,
} from '@repo/shared-types';
import { blankToUndefined, errorMessage, formSchema, zodMessages } from '../forms';
import { PimApi } from '../pim-api';

interface RowEdit {
  categoryId?: string;
  channels: Record<string, string>;
}

/** FR-CAT-001: map each supplier department / sub-department / family to an internal and per-channel category. */
@Component({
  selector: 'app-category-mapping',
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">Category mapping</h1>

    <form class="mb-6 flex items-end gap-3" [formGroup]="categoryForm" (ngSubmit)="createCategory()">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>New category</mat-label>
        <input matInput data-testid="category-name-input" formControlName="name" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Parent</mat-label>
        <select matNativeControl data-testid="category-parent-select" formControlName="parentId">
          <option value="">None</option>
          @for (c of categories.data()?.items ?? []; track c.id) { <option [value]="c.id">{{ c.name }}</option> }
        </select>
      </mat-form-field>
      <button mat-flat-button type="submit" data-testid="create-category-button">Create category</button>
      @if (categorySubmitted() && categoryForm.invalid) {
        <span class="text-red-600" data-testid="category-error">{{ messages(categoryForm.errors).join(', ') }}</span>
      }
    </form>

    @if (paths.isError()) { <p class="text-red-600">{{ message(paths.error()) }}</p> }
    @if (saveError()) { <p class="text-red-600">{{ saveError() }}</p> }

    <table class="w-full text-left">
      <thead><tr><th>Supplier path</th><th>Products</th><th>Internal category</th>
        @for (ch of channels(); track ch.id) { <th>{{ ch.code }}</th> }
        <th></th></tr></thead>
      <tbody>
        @for (row of paths.data()?.items ?? []; track $index; let i = $index) {
          <tr data-testid="path-row">
            <td>{{ label(row) }}</td>
            <td>{{ row.productCount }}</td>
            <td>
              <select [attr.data-testid]="'category-select-' + i" (change)="setCategory(i, $any($event.target).value)">
                <option value="">Select...</option>
                @for (c of categories.data()?.items ?? []; track c.id) {
                  <option [value]="c.id" [selected]="c.id === categoryOf(i, row.categoryId)">{{ c.name }}</option>
                }
              </select>
            </td>
            @for (ch of channels(); track ch.id) {
              <td>
                <select [attr.data-testid]="'channel-select-' + i + '-' + ch.id" (change)="setChannel(i, ch, $any($event.target).value)">
                  <option value="">Select...</option>
                  @for (n of leaves(ch.id); track n.id) {
                    <option [value]="n.id" [selected]="n.id === channelOf(i, ch.id, row.channels)">{{ n.name }}</option>
                  }
                </select>
                @if (mandatory()[i + '-' + ch.id]; as attrs) {
                  <div [attr.data-testid]="'mandatory-' + i + '-' + ch.id" class="text-xs">Mandatory: {{ attrs.join(', ') || 'none' }}</div>
                }
              </td>
            }
            <td>
              <button mat-flat-button type="button" [attr.data-testid]="'save-mapping-' + i" [disabled]="!categoryOf(i, row.categoryId) || save.isPending()" (click)="saveRow(i, row)">Save</button>
            </td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class CategoryMapping {
  private readonly api = inject(PimApi);
  private readonly queryClient = inject(QueryClient);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly message = errorMessage;
  protected readonly messages = zodMessages;

  protected readonly categoryForm = this.formBuilder.nonNullable.group(
    { name: [''], parentId: [''] },
    { validators: zodValidator(formSchema(createCategoryRequestSchema)) },
  );
  protected readonly categorySubmitted = signal(false);

  protected readonly edits = signal<Record<number, RowEdit>>({});
  protected readonly mandatory = signal<Record<string, string[]>>({});
  protected readonly saveError = signal<string | null>(null);

  protected readonly paths = injectQuery(() => ({
    queryKey: ['pim', 'supplier-paths'],
    queryFn: () => this.api.supplierPaths(),
  }));
  protected readonly categories = injectQuery(() => ({
    queryKey: ['pim', 'categories'],
    queryFn: () => this.api.categories(),
  }));
  private readonly settings = injectQuery(() => ({
    queryKey: ['pim', 'settings'],
    queryFn: () => this.api.settings(),
  }));
  protected readonly channels = computed<ChannelSettings[]>(() => this.settings.data()?.channels ?? []);

  private readonly trees = injectQuery(() => ({
    queryKey: ['pim', 'channel-trees', this.channels().map((c) => c.id)],
    enabled: this.channels().length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        this.channels().map(async (c) => [c.id, (await this.api.channelCategories(c.id)).items] as const),
      );
      return Object.fromEntries(entries);
    },
  }));

  protected readonly save = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof mapSupplierPathRequestSchema.parse>) => this.api.mapSupplierPath(body),
    onSuccess: () => this.queryClient.invalidateQueries({ queryKey: ['pim', 'supplier-paths'] }),
  }));

  private readonly loadAttributes = injectMutation(() => ({
    mutationFn: (v: { key: string; channelId: string; channelCategoryId: string }) =>
      this.api.channelAttributes(v.channelId, v.channelCategoryId).then((r) => ({ key: v.key, mandatory: r.mandatory })),
    onSuccess: (r) => this.mandatory.update((m) => ({ ...m, [r.key]: r.mandatory })),
  }));

  private readonly createCategoryMutation = injectMutation(() => ({
    mutationFn: (body: ReturnType<typeof createCategoryRequestSchema.parse>) => this.api.createCategory(body),
    onSuccess: () => {
      this.categoryForm.reset();
      this.categorySubmitted.set(false);
      return this.queryClient.invalidateQueries({ queryKey: ['pim', 'categories'] });
    },
  }));

  protected label(row: { department: string | null; subDepartment: string | null; family: string | null }): string {
    return [row.department, row.subDepartment, row.family].filter(Boolean).join(' / ');
  }

  protected leaves(channelId: string) {
    return (this.trees.data()?.[channelId] ?? []).filter((n) => n.leaf);
  }

  protected categoryOf(i: number, stored: string | null): string {
    return this.edits()[i]?.categoryId ?? stored ?? '';
  }

  protected channelOf(i: number, channelId: string, stored: { channelId: string; channelCategoryId: string | null }[]): string {
    return this.edits()[i]?.channels[channelId] ?? stored.find((c) => c.channelId === channelId)?.channelCategoryId ?? '';
  }

  protected setCategory(i: number, categoryId: string): void {
    this.edits.update((e) => ({ ...e, [i]: { channels: e[i]?.channels ?? {}, categoryId } }));
  }

  protected setChannel(i: number, channel: ChannelSettings, channelCategoryId: string): void {
    this.edits.update((e) => ({
      ...e,
      [i]: { ...e[i], channels: { ...(e[i]?.channels ?? {}), [channel.id]: channelCategoryId } },
    }));
    if (channel.code === 'temu-eu' && channelCategoryId) {
      this.loadAttributes.mutate({ key: `${i}-${channel.id}`, channelId: channel.id, channelCategoryId });
    }
  }

  protected saveRow(
    i: number,
    row: { department: string | null; subDepartment: string | null; family: string | null; categoryId: string | null; channels: { channelId: string; channelCategoryId: string | null }[] },
  ): void {
    this.saveError.set(null);
    const channels = this.channels()
      .map((c) => ({ channelId: c.id, channelCategoryId: this.channelOf(i, c.id, row.channels) }))
      .filter((c) => c.channelCategoryId);
    const parsed = mapSupplierPathRequestSchema.safeParse(
      blankToUndefined({
        department: row.department ?? undefined,
        subDepartment: row.subDepartment ?? undefined,
        family: row.family ?? undefined,
        categoryId: this.categoryOf(i, row.categoryId),
        channels,
      }),
    );
    if (!parsed.success) {
      this.saveError.set(parsed.error.issues.map((x) => x.message).join(', '));
      return;
    }
    this.save.mutate(parsed.data);
  }

  protected createCategory(): void {
    this.categorySubmitted.set(true);
    if (this.categoryForm.invalid || this.createCategoryMutation.isPending()) return;
    this.createCategoryMutation.mutate(createCategoryRequestSchema.parse(blankToUndefined(this.categoryForm.getRawValue())));
  }
}
