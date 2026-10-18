export type Confirmation = {
  title: string;
  description: string;
  label: string;
  danger?: boolean;
  action: () => Promise<unknown>;
};
export type Repository = { slug: string; name: string; url: string; source?: string };
export function ManagementFeedback({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="management-notice">
          {notice}
        </p>
      )}
    </>
  );
}
