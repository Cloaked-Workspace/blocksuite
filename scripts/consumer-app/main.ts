// A separate application that consumes the published distribution only.
//
// Nothing here imports from the BlockSuite repository: every specifier below
// resolves to an installed `@cloaked-workspace/*` tarball. The distribution
// ships no editor element, so this file builds its own host the way a real
// consumer has to — `BlockStdScope` plus lit's `render`.
//
// Deliberately no `import '@cloaked-workspace/blocksuite-affine/effects'`. That
// subpath compiles to binding-free imports of type-only declarations, so it
// registers nothing and the builder correctly leaves the package
// `sideEffects: false`, which makes bundlers drop the import. Element
// registration comes from the view extensions below, which call each block's
// `effects()` during setup. This proof asserts that.
import { getInternalStoreExtensions } from '@cloaked-workspace/blocksuite-affine/extensions/store';
import { getInternalViewExtensions } from '@cloaked-workspace/blocksuite-affine/extensions/view';
import {
  StoreExtensionManager,
  ViewExtensionManager,
} from '@cloaked-workspace/blocksuite-affine/ext-loader';
import { BlockStdScope } from '@cloaked-workspace/blocksuite-affine/std';
import { Text } from '@cloaked-workspace/blocksuite-affine/store';
import { TestWorkspace } from '@cloaked-workspace/blocksuite-affine/store/test';
import { render } from 'lit';

declare global {
  interface Window {
    consumerProbe: {
      paragraphText: () => string | undefined;
      blockFlavours: () => string[];
      appendParagraph: (text: string) => void;
    };
  }
}

const storeManager = new StoreExtensionManager(getInternalStoreExtensions());
const viewManager = new ViewExtensionManager(getInternalViewExtensions());

const workspace = new TestWorkspace({ id: 'cw-consumer' });
workspace.storeExtensions = storeManager.get('store');
// Without this the workspace meta has no `pages` array and `createDoc` returns
// null instead of throwing.
workspace.meta.initialize();
workspace.start();

const docId = 'consumer-doc';
const doc = workspace.createDoc(docId);
const store = doc.getStore({ id: docId });
store.load();

const rootId = store.addBlock('affine:page', {
  title: new Text('Consumer smoke test'),
});
store.addBlock('affine:surface', {}, rootId);
const noteId = store.addBlock('affine:note', { xywh: '[0, 100, 800, 640]' }, rootId);
store.addBlock(
  'affine:paragraph',
  { text: new Text('Hello from a separate project') },
  noteId
);
store.resetHistory();

const std = new BlockStdScope({
  store,
  extensions: viewManager.get('page'),
});

const mount = document.getElementById('app');
if (!mount) throw new Error('missing #app');
// The root block registers `ViewportElementExtension('.affine-page-viewport')`,
// so the host must sit inside an ancestor carrying that class.
const viewport = document.createElement('div');
viewport.className = 'affine-page-viewport';
mount.append(viewport);
render(std.render(), viewport);

// Exposed so the browser test can assert against the live document model
// rather than against the DOM alone.
window.consumerProbe = {
  paragraphText: () =>
    store.getBlocksByFlavour('affine:paragraph')[0]?.model.props.text?.toString(),
  blockFlavours: () => store.getAllModels().map(model => model.flavour),
  appendParagraph: (text: string) => {
    store.addBlock('affine:paragraph', { text: new Text(text) }, noteId);
  },
};
