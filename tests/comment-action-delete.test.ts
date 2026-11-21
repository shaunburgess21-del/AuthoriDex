import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  containPortaledSheetEvent,
  runCommentDeleteAction,
} from "../client/src/components/comments/commentActionDelete";

describe("voices delete menu handler", () => {
  it("opens confirm and does not let the click close the overlay", () => {
    let confirmOpened = false;
    let stopped = false;
    runCommentDeleteAction(
      { stopPropagation: () => { stopped = true; } },
      () => { confirmOpened = true; },
    );
    const overlayClosed = !stopped;
    assert.equal(confirmOpened, true);
    assert.equal(overlayClosed, false);
  });

  it("still stops the click when Delete is not offered", () => {
    let stopped = false;
    runCommentDeleteAction(
      { stopPropagation: () => { stopped = true; } },
      undefined,
    );
    assert.equal(stopped, true);
  });

  it("contains every click inside the portaled sheet", () => {
    let stopped = false;
    containPortaledSheetEvent({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
  });
});

describe("delete sheet wiring", () => {
  const drawer = readFileSync(
    new URL("../client/src/components/comments/CommentActionDrawer.tsx", import.meta.url),
    "utf8",
  );
  const overlay = readFileSync(
    new URL("../client/src/components/voices/VoicesPostOverlay.tsx", import.meta.url),
    "utf8",
  );
  const profilePost = readFileSync(
    new URL("../client/src/components/PostOverlayModal.tsx", import.meta.url),
    "utf8",
  );
  const dialog = readFileSync(
    new URL("../client/src/components/comments/DeleteContentDialog.tsx", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../client/src/lib/queryClient.ts", import.meta.url),
    "utf8",
  );

  it("wires Delete through the handler that stops the portal click", () => {
    assert.match(drawer, /runCommentDeleteAction\(event, onDelete\)/);
    assert.match(drawer, /onClick=\{containPortaledSheetEvent\}/);
    assert.match(drawer, /data-testid="comment-action-delete"/);
  });

  it("asks to confirm, shows a pending delete, and toasts success or failure", () => {
    assert.match(overlay, /title="Delete this post\?"/);
    assert.match(overlay, /isPending=\{deletePost\.isPending\}/);
    assert.match(overlay, /toast\.success\("Post deleted"\)/);
    assert.match(overlay, /voicesPostDeleteErrorCopy/);
    assert.match(overlay, /toast\.error\(copy\.title/);
    assert.match(profilePost, /title="Delete this post\?"/);
    assert.match(dialog, /variant="destructive"/);
    assert.match(dialog, />\s*Cancel\s*</);
    assert.match(dialog, /Deleting…/);
  });

  it("sends DELETE /api/comments/:id with the bearer token apiRequest adds", () => {
    assert.match(overlay, /voicesPostDeleteRequest\(item\.id\)/);
    assert.match(overlay, /apiRequest\(request\.method, request\.path\)/);
    assert.match(api, /"Authorization": `Bearer \$\{session\.access_token\}`/);
  });

  it("removes the post from cached feeds and closes the overlay", () => {
    assert.match(overlay, /removeDeletedVoicesPost\(queryClient, item\.id\)/);
    assert.match(overlay, /onClose\(\)/);
  });
});
