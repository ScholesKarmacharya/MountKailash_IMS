import { randomUUID } from "node:crypto";
import type { Product } from "@/domain/inventory/validation";
import { AdminDialog, DialogClose } from "./admin-dialog";
import { OperationForm, Field, Select } from "./operation-form";
import { Input } from "./ui/input";
import { Message, T } from "./localization";

export function ProductPricingEditor({ product }: { product: Product }) {
  return (
    <AdminDialog
      title="Edit Pricing"
      triggerLabel="Edit"
      context={product.name}
    >
      <OperationForm
        operation="house:pricing"
        requestKey={randomUUID()}
        label="Save pricing"
        version={product.version}
        actions={<DialogClose />}
        successActions={<DialogClose label="Close" />}
      >
        <input type="hidden" name="product" value={product.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium">
            <T k="Default selling price (NPR)" />
            <Input
              name="price"
              defaultValue={product.default_price}
              inputMode="decimal"
              required
              pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
              maxLength={15}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            <T k="Reference Price (NPR)" />
            <Input
              name="reference_price"
              defaultValue={product.reference_price ?? product.default_price}
              inputMode="decimal"
              required
              pattern="[0-9]{1,12}(\.[0-9]{1,2})?"
              maxLength={15}
            />
          </label>
          <Select
            name="eligible"
            label="HOUSE Eligibility"
            value={String(product.house_eligible)}
          >
            <option value="true">
              <T k="Eligible" />
            </option>
            <option value="false">
              <T k="Not eligible" />
            </option>
          </Select>
          <div className="self-center text-sm text-muted-foreground">
            <T k="Unit" />: <Message value={product.unit} />
          </div>
        </div>
        <Field
          name="reason"
          label="Reason for this change"
          required
          maxLength={500}
        />
        <p className="text-xs text-muted-foreground">
          <T k="Price changes apply to future deliveries. Previous selling and reference price snapshots stay unchanged." />
        </p>
      </OperationForm>
    </AdminDialog>
  );
}
