"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function (t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function () { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function () { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUDForensicsLimb = void 0;
var module_1 = require("module");
var path = require("path");
var require = (0, module_1.createRequire)(import.meta.url);
var GameCacheLoader = null;
var parse = null;
var models_js_1 = require("../../core/models.js");
var logger_js_1 = require("../../utils/logger.js");
var SovereignPathResolver_js_1 = require("../../utils/SovereignPathResolver.js");
var RSMV = (0, SovereignPathResolver_js_1.getRSMVSubstratePath)();
try {
    (GameCacheLoader = require(path.join(RSMV, 'src', 'cache', 'sqlite.js')).GameCacheLoader);
}
catch (_a) { }
try {
    (parse = require(path.join(RSMV, 'src', 'opdecoder.js')).parse);
}
catch (_b) { }
var WikiEnricher_js_1 = require("../../utils/WikiEnricher.js");
var logger = (0, logger_js_1.createLogger)('HUDForensicsLimb');
/**
 * HUDForensicsLimb - Sovereign Interface Epistemology
 *
 * Responsibilities:
 * 1. Real-time extraction of HUD/Interface data from Jagex Cache (Major 3).
 * 2. Forensic deconstruction of interface hierarchies.
 * 3. Semantic mapping of interface components to Atlas principles.
 */
var HUDForensicsLimb = /** @class */ (function () {
    function HUDForensicsLimb() {
        this.cachePath = (0, SovereignPathResolver_js_1.getRSMVCachePath)();
        this.cache = null;
        this.pedagogyCandidateDir = path.join((0, SovereignPathResolver_js_1.getSovereignRoot)(), 'cache_pedagogy', 'atlas', 'interfaces');
        try {
            if (GameCacheLoader) {
                this.cache = new GameCacheLoader(this.cachePath);
                this.cache.buildnr = 940; // RS3 Build
                logger.info({ path: this.cachePath }, 'HUDForensicsLimb connected to Jagex Cache substrate.');
            }
            else {
                logger.warn('HUDForensicsLimb: GameCacheLoader not available.');
            }
        }
        catch (e) {
            logger.error({ error: e.message }, 'Failed to connect to GameCacheLoader.');
        }
    }
    /**
     * getInterface(id) - Extracts and deconstructs an interface from the cache.
     */
    HUDForensicsLimb.prototype.getInterface = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var rawBuffer, state, components, textLabels, parentToIndex, compId, startScan, comp, component, children, dumpStart, dumpEnd, hexDump, pointer, _i, components_1, comp, isHudCandidate, wikiContext, query, wikiRes, error_1;
            var _a, _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        if (!this.cache)
                            return [2 /*return*/, (0, models_js_1.err)(new Error('Cache substrate not connected.'))];
                        if (!parse)
                            return [2 /*return*/, (0, models_js_1.err)(new Error('HUDForensicsLimb: parse not available.'))];
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 5, , 6]);
                        return [4 /*yield*/, this.cache.getFile(3, id)];
                    case 2:
                        rawBuffer = _d.sent();
                        state = {
                            isWrite: false,
                            buffer: rawBuffer,
                            stack: [],
                            hiddenstack: [],
                            scan: 0,
                            endoffset: rawBuffer.byteLength,
                            args: __assign(__assign({}, this.cache.getDecodeArgs()), {
                                clientVersion: 940 // Explicitly force RS3/NXT context
                            })
                        };
                        components = [];
                        textLabels = [];
                        parentToIndex = new Map();
                        compId = 0;
                        while (state.scan < state.endoffset) {
                            startScan = state.scan;
                            try {
                                comp = parse.interfaces.parser.read(state);
                                // Forensic check: Log if we see a weird type or version
                                if (compId === 0) {
                                    logger.info({ id: id, version: comp.version, type: comp.type, firstByte: rawBuffer[startScan] }, 'First component forensic header.');
                                }
                                component = {
                                    componentId: compId,
                                    type: comp.type !== undefined ? this.mapTypeIdToName(comp.type) : 'UNKNOWN',
                                    text: ((_a = comp.textdata) === null || _a === void 0 ? void 0 : _a.text) || comp.text,
                                    spriteId: ((_b = comp.spritedata) === null || _b === void 0 ? void 0 : _b.spriteid) || comp.spriteid,
                                    modelId: ((_c = comp.modeldata) === null || _c === void 0 ? void 0 : _c.modelid) || comp.modelid,
                                    hidden: !!comp.hidden,
                                    parentId: comp.parentid !== undefined ? comp.parentid : -1,
                                    children: []
                                };
                                if (component.text)
                                    textLabels.push(component.text);
                                components.push(component);
                                if (component.parentId !== -1 && component.parentId !== 65535) {
                                    children = parentToIndex.get(component.parentId) || [];
                                    children.push(compId);
                                    parentToIndex.set(component.parentId, children);
                                }
                                compId++;
                            }
                            catch (err) {
                                dumpStart = Math.max(0, state.scan - 20);
                                dumpEnd = Math.min(rawBuffer.byteLength, state.scan + 20);
                                hexDump = rawBuffer.subarray(dumpStart, dumpEnd).toString('hex');
                                pointer = ' '.repeat((state.scan - dumpStart) * 2) + '^^';
                                logger.error({
                                    id: id,
                                    scan: state.scan,
                                    hexAround: hexDump,
                                    pointerAtHex: pointer,
                                    error: err.message
                                }, 'Forensic decompile failure detected.');
                                // Forensic salvage: If we can't parse more, we return what we have
                                break;
                            }
                        }
                        // Fill children
                        for (_i = 0, components_1 = components; _i < components_1.length; _i++) {
                            comp = components_1[_i];
                            comp.children = parentToIndex.get(comp.componentId) || [];
                        }
                        isHudCandidate = textLabels.some(function (t) {
                            return /inventory|skill|chat|map|quest|ability|friend|clan/i.test(t);
                        });
                        wikiContext = void 0;
                        if (!(isHudCandidate && textLabels.length > 0)) return [3 /*break*/, 4];
                        query = textLabels.sort(function (a, b) { return b.length - a.length; })[0];
                        return [4 /*yield*/, WikiEnricher_js_1.WikiEnricher.enrich(query)];
                    case 3:
                        wikiRes = _d.sent();
                        if (wikiRes.ok)
                            wikiContext = wikiRes.value;
                        _d.label = 4;
                    case 4: return [2 /*return*/, (0, models_js_1.ok)({
                        interfaceId: id,
                        components: components,
                        textLabels: textLabels,
                        isHudCandidate: isHudCandidate,
                        wikiContext: wikiContext
                    })];
                    case 5:
                        error_1 = _d.sent();
                        logger.error({ interfaceId: id, error: error_1 }, 'Failed to decompile interface.');
                        return [2 /*return*/, (0, models_js_1.err)(error_1)];
                    case 6: return [2 /*return*/];
                }
            });
        });
    };
    /**
     * searchInterfaces(query) - Forensic scan across interface text labels.
     */
    HUDForensicsLimb.prototype.searchInterfaces = function (query_1) {
        return __awaiter(this, arguments, void 0, function (query, limit) {
            var results, regex, id, res, _a;
            if (limit === void 0) { limit = 10; }
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (!this.cache)
                            return [2 /*return*/, (0, models_js_1.err)(new Error('Cache substrate not connected.'))];
                        results = [];
                        regex = new RegExp(query, 'i');
                        id = 0;
                        _b.label = 1;
                    case 1:
                        if (!(id < 2000)) return [3 /*break*/, 6];
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.getInterface(id)];
                    case 3:
                        res = _b.sent();
                        if (res.ok && res.value.textLabels.some(function (t) { return regex.test(t); })) {
                            results.push(res.value);
                            if (results.length >= limit)
                                return [3 /*break*/, 6];
                        }
                        return [3 /*break*/, 5];
                    case 4:
                        _a = _b.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        id++;
                        return [3 /*break*/, 1];
                    case 6: return [2 /*return*/, (0, models_js_1.ok)(results)];
                }
            });
        });
    };
    /**
     * Map internal numeric types to semantic names.
     */
    HUDForensicsLimb.prototype.mapTypeIdToName = function (typeId) {
        var types = {
            0: 'CONTAINER',
            3: 'FIGURE',
            4: 'TEXT',
            5: 'SPRITE',
            6: 'MODEL',
            9: 'LINE',
            10: 'TYPE_10',
            11: 'TYPE_11',
            12: 'TYPE_12',
            13: 'TYPE_13',
            14: 'TYPE_14',
            15: 'TYPE_15',
            16: 'TYPE_16'
        };
        return types[typeId] || "UNKNOWN_".concat(typeId);
    };
    /**
     * Diagnostic probe.
     */
    HUDForensicsLimb.prototype.healthCheck = function () {
        return {
            online: !!this.cache,
            details: this.cache ? 'HUDForensicsLimb active; Major 3 connected.' : 'HUDForensicsLimb OFFLINE; cache path invalid.'
        };
    };
    return HUDForensicsLimb;
}());
exports.HUDForensicsLimb = HUDForensicsLimb;
