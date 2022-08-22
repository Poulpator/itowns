function disposeSingleMaterialAndTextures(material) {
    material.dispose();
    // dispose textures
    for (const key of Object.keys(material)) {
        const val = material[key];
        if (val && val.isTexture) {
            val.dispose();
        }
    }
}

export default {
    /**
     * Cleanup obj to release three.js allocated resources
     * @param {Object3D} obj object to release
     */
    cleanup(obj) {
        obj.layer = null;

        // THREE.Scene dispose function displays a deprecation message
        if (!obj.isScene && typeof obj.dispose === 'function') {
            obj.dispose();
        } else {
            if (obj.geometry) {
                obj.geometry.dispose();
                // the Object Removal Helper causes inconsistencies
                // when it assigns null to a geometry present in the Cache.
                // Actually, the cache can provide a mesh whose geometry is null.
                // see https://github.com/iTowns/itowns/issues/869
                // obj.geometry = null;
            }
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    for (const material of obj.material) {
                        disposeSingleMaterialAndTextures(material);
                    }
                } else {
                    disposeSingleMaterialAndTextures(obj.material);
                }
            }
            obj.dispatchEvent({ type: 'dispose' });
        }
    },

    /**
     * Remove obj's children belonging to a layer.
     * Neither obj nor its children will be disposed!
     * @param {Layer} layer The layer that objects must belong to. Other object are ignored
     * @param {Object3D} obj The Object3D we want to clean
     * @return {Array} an array of removed Object3D from obj (not including the recursive removals)
     */
    removeChildren(layer, obj) {
        const toRemove = obj.children.filter(c => (c.layer && c.layer.id) === layer.id);
        obj.remove(...toRemove);
        return toRemove;
    },

    /**
     * Remove an obj and all its children belonging to a layer and only cleanup the obj (and not its children).
     * obj will be disposed but its children **won't**!
     * @param {Layer} layer The layer that objects must belong to. Other object are ignored
     * @param {Object3D} obj The Object3D we want to clean
     * @return {Array} an array of removed Object3D from obj (not including the recursive removals)
     */
    removeChildrenAndCleanup(layer, obj) {
        const toRemove = obj.children.filter(c => (c.layer && c.layer.id) === layer.id);

        obj.remove(...toRemove);
        if (obj.layer === layer) {
            this.cleanup(obj);
        }
        return toRemove;
    },

    /**
     * Recursively remove an obj and all its children belonging to a layer.
     * All removed obj will have their geometry/material disposed.
     * @param {Layer} layer The layer that objects must belong to. Other object are ignored
     * @param {Object3D} obj The Object3D we want to clean
     * @return {Array} an array of removed Object3D from obj (not including the recursive removals)
     */
    removeChildrenAndCleanupRecursively(layer, obj) {
        let toRemove = obj.children.filter(c => (c.layer && c.layer.id) === layer.id);
        if (obj.link) {
            toRemove = toRemove.concat(obj.link);
        }
        for (const c of toRemove) {
            this.removeChildrenAndCleanupRecursively(layer, c);
        }
        obj.remove(...toRemove);
        if (obj.layer && obj.layer.id === layer.id) {
            this.cleanup(obj);
        }
        return toRemove;
    },
};
