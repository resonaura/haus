//! Compiled base styles and pre-resolved background shaders for ordinary retained host elements.

use std::sync::{Arc, Weak};

use gpui::StyleRefinement;
use rustc_hash::FxHashMap;

use crate::compositor::{resolve_background_shaders, ResolvedBackgroundShader};

use super::StyleDesc;

const MAX_STYLES: usize = 4096;

pub(crate) struct CachedHostStyle {
    style: Weak<StyleDesc>,
    pub refinement: StyleRefinement,
    pub shaders: Option<Box<[ResolvedBackgroundShader]>>,
}

#[derive(Default)]
pub(crate) struct HostStyles {
    styles: FxHashMap<*const StyleDesc, CachedHostStyle>,
}

impl HostStyles {
    pub fn resolve_entry(&mut self, style: &Arc<StyleDesc>) -> &CachedHostStyle {
        let key = Arc::as_ptr(style);
        if self.styles.contains_key(&key) {
            return self.styles.get(&key).expect("just checked");
        }
        if self.styles.len() >= MAX_STYLES {
            self.styles.retain(|_, entry| entry.style.strong_count() > 0);
            if self.styles.len() >= MAX_STYLES {
                self.styles.clear();
            }
        }
        let refinement = crate::renderer::apply_styles(StyleRefinement::default(), style);
        let shaders = resolve_background_shaders(style);
        // The weak pointer prevents key reuse and does not retain the input style.
        self.styles.insert(
            key,
            CachedHostStyle {
                style: Arc::downgrade(style),
                refinement,
                shaders,
            },
        );
        self.styles.get(&key).expect("just inserted")
    }

    pub fn prune(&mut self) {
        if self.styles.len() >= MAX_STYLES {
            self.styles.retain(|_, entry| entry.style.strong_count() > 0);
        }
    }
}
