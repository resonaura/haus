//! Compiled base styles for ordinary retained host elements.

use std::sync::{Arc, Weak};

use gpui::StyleRefinement;
use rustc_hash::FxHashMap;

use super::StyleDesc;

const MAX_STYLES: usize = 256;

#[derive(Default)]
pub(crate) struct HostStyles {
    styles: FxHashMap<*const StyleDesc, (Weak<StyleDesc>, StyleRefinement)>,
}

impl HostStyles {
    pub fn resolve(&mut self, style: &Arc<StyleDesc>) -> StyleRefinement {
        let key = Arc::as_ptr(style);
        if let Some((_, compiled)) = self.styles.get(&key) {
            return compiled.clone();
        }
        let compiled = crate::renderer::apply_styles(StyleRefinement::default(), style);
        if self.styles.len() < MAX_STYLES {
            // The weak pointer prevents key reuse and does not retain the input style.
            self.styles.insert(key, (Arc::downgrade(style), compiled.clone()));
        }
        compiled
    }

    pub fn prune(&mut self) {
        if self.styles.len() == MAX_STYLES {
            self.styles.retain(|_, (style, _)| style.strong_count() > 0);
        }
    }
}
