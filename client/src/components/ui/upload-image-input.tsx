import { useState, useRef, useCallback } from "react";
import { Upload, X, Image as ImageIcon, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabase } from "@/lib/supabase";

interface UploadImageInputProps {
  value: string;
  onChange: (url: string) => void;
  moduleName?: string;
  slugOrId?: string;
  disabled?: boolean;
  placeholder?: string;
}

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_SIZE = 2 * 1024 * 1024;
const BUCKET_NAME = "public-images";

export function UploadImageInput({
  value,
  onChange,
  moduleName = "general",
  slugOrId = "unnamed",
  disabled = false,
  placeholder = "Paste image URL or upload a file",
}: UploadImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Only PNG, JPG, and WEBP files are allowed");
      return;
    }
    if (file.size > MAX_SIZE) {
      setError("File must be under 2MB");
      return;
    }

    setUploading(true);
    setProgress(10);

    try {
      const supabase = await getSupabase();
      setProgress(20);

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const timestamp = Date.now();
      const filePath = `${moduleName}/${slugOrId}/${timestamp}.${ext}`;

      setProgress(40);

      const { data, error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      setProgress(80);

      if (uploadError) {
        throw new Error(uploadError.message || "Upload failed");
      }

      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(filePath);

      setProgress(100);
      onChange(urlData.publicUrl);
    } catch (err: any) {
      const msg = err.message || "Upload failed";
      if (msg.includes("Bucket not found") || msg.includes("not found")) {
        setError("Storage bucket not configured. Please create a 'public-images' bucket in your Supabase dashboard.");
      } else {
        setError(msg);
      }
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 500);
    }
  }, [moduleName, slugOrId, onChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [uploadFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const handleClear = useCallback(() => {
    onChange("");
    setError(null);
  }, [onChange]);

  return (
    <div className="space-y-2" data-testid="upload-image-input">
      <div
        className={`flex items-center gap-2 ${dragOver ? "ring-2 ring-cyan-500/50 rounded-md" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <Input
          value={value}
          onChange={(e) => { onChange(e.target.value); setError(null); }}
          placeholder={placeholder}
          disabled={disabled || uploading}
          className="flex-1"
          data-testid="input-image-url"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
          data-testid="button-upload-image"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={disabled || uploading}
            data-testid="button-clear-image"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp"
        className="hidden"
        onChange={handleFileSelect}
        data-testid="input-file-upload"
      />

      {uploading && (
        <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden" data-testid="upload-progress">
          <div
            className="h-full bg-cyan-500 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400" data-testid="text-upload-error">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {value && !uploading && (
        <div className="flex items-center gap-3 p-2 rounded-md bg-white/5 border border-white/10" data-testid="image-preview">
          <div className="h-12 w-12 rounded overflow-hidden bg-white/10 flex items-center justify-center shrink-0">
            <img
              src={value}
              alt="Preview"
              className="h-full w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
                (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
              }}
            />
            <ImageIcon className="h-5 w-5 text-muted-foreground hidden" />
          </div>
          <span className="text-xs text-muted-foreground truncate flex-1">{value}</span>
        </div>
      )}
    </div>
  );
}
