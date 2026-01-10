export default function AdminTestPage() {
  console.log("!!! ADMIN TEST PAGE MOUNTING !!!");
  
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-green-500" data-testid="text-test-success">TEST SUCCESS</h1>
        <p className="text-muted-foreground mt-4">Router is working. No auth checks on this page.</p>
      </div>
    </div>
  );
}
