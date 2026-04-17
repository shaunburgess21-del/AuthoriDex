import { Input } from "@/components/ui/input";

export type ProfileImageReviewValues = {
  sourceCredit: string;
};

export function ProfileImageReviewFields({
  values,
  onChange,
  personName,
  imageUrl,
}: {
  values: ProfileImageReviewValues;
  onChange: (next: ProfileImageReviewValues) => void;
  personName: string;
  imageUrl: string;
}) {
  return (
    <div className="space-y-4">
      {personName && (
        <div>
          <label className="text-sm font-medium mb-1 block text-muted-foreground">Celebrity</label>
          <p className="text-sm">{personName}</p>
        </div>
      )}
      {imageUrl && (
        <div>
          <label className="text-sm font-medium mb-1 block">Image Preview</label>
          <img
            src={imageUrl}
            alt="Submitted image"
            className="rounded-md max-h-48 w-auto object-contain border border-border"
          />
        </div>
      )}
      <div>
        <label className="text-sm font-medium mb-1 block">Source Credit (optional)</label>
        <Input
          value={values.sourceCredit}
          onChange={(e) => onChange({ ...values, sourceCredit: e.target.value })}
          placeholder="e.g. @photographer or website.com"
        />
      </div>
    </div>
  );
}
