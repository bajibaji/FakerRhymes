		// 从字典查询拼音组合对应的词组（新算法）
		// 使用最后两个字的韵脚为查询条件，返回所有相关匹配
		const queryDict = (infos, looseness) => {
			if (!infos || infos.length === 0) return null;
			
			// 修改：不再强制只取最后两个字，而是根据输入长度决定
			// 用户要求：查询条件跟生成结果一样，字数由用户输入决定
			let queryInfos = infos;
			
			// 验证韵脚信息的有效性
			const validInfos = queryInfos.filter(info => info.fin && info.fin !== '-');
			if (validInfos.length === 0) return null;
			
			const tier = getLoosenessTier(looseness);
			const allowToneRelax = tier >= 2;
			
			// 生成所有可能的查询键变体
			const generateQueryKeys = (infos) => {
				const keys = [];
				const recurse = (index, current) => {
					if (index === infos.length) {
						keys.push(current.join('_'));
						return;
					}
					const info = infos[index];
					// Tier 2: 所有字都允许声调放宽（因为只处理最后两个字，组合数可控）
					// Tier 0/1: 必须严格匹配声调
					const toneVariants = allowToneRelax ? [1,2,3,4] : [info.tone];
					
					// 获取该韵母的所有变体
					const finVariants = buildFinalVariants(info.fin, tier);
					
					// 扩展为旧字典的键值
					const expandedVariants = new Set();
					for (const v of finVariants) {
						expandedVariants.add(v);
						if (legacyKeyMap[v]) {
							legacyKeyMap[v].forEach(k => expandedVariants.add(k));
						}
					}

					for (const fin of expandedVariants) {
						for (const tone of toneVariants) {
							const keyPart = `${fin}${tone}`;
							recurse(index + 1, [...current, keyPart]);
						}
					}
				};
				recurse(0, []);
				return keys;
			};
			
			const queryKeys = generateQueryKeys(validInfos);
			const queryVariantSet = new Set();
			queryKeys.forEach(k => {
				buildKeyVariants(k).forEach(v => {
					const encoded = encodeKey(v);
					if (bloomFilter.mightContain(encoded)) {
						queryVariantSet.add(encoded);
					}
				});
			});
			
			// 在字典中搜索所有可能的匹配
			const matchedByWordCount = {};
			const sourceLength = infos.length;
			
			// 遍历查询变体集而不是整个字典
			if (dict) {
				const queryVariants = Array.from(queryVariantSet);
				for (const qk of queryVariants) {
					// 直接查询 encoded key
					const candidates = dict[qk];
					if (candidates && Array.isArray(candidates)) {
						for (const phrase of candidates) {
							const phraseLen = Array.from(phrase).length;
							if (!matchedByWordCount[phraseLen]) {
								matchedByWordCount[phraseLen] = [];
							}
							if (!matchedByWordCount[phraseLen].includes(phrase)) {
								matchedByWordCount[phraseLen].push(phrase);
							}
						}
					}
				}
				
				// 还需要处理以 qk 结尾的键 (例如 query 是 "an4_u4", 字典中有 "i1_an4_u4")
				// 优化：不再全量扫描字典，而是假设词典中词语长度有限（通常不超过4-5个字）
				// 这里的逻辑可以改为：对于 queryVariantSet 中的每个 key，检查它是否是字典中某些 key 的后缀
				// 但由于字典很大，后缀匹配仍然慢。
				// 更好的方案是在加载字典时建立后缀索引，但由于目前文件结构限制，我们采用增量搜索的折中方案。
				
				// 如果查询字数小于字典条目长度，才需要进行后缀匹配
				if (queryVariants.length > 0) {
					for (const [dictKey, candidates] of Object.entries(dict)) {
						// 优化：只有当 dictKey 以查询变体之一结尾时才匹配
						const hasSuffixMatch = queryVariants.some(qk => {
							return dictKey.length > qk.length && dictKey.endsWith(qk);
						});
						
						if (!hasSuffixMatch) continue;
						if (candidates && Array.isArray(candidates)) {
							for (const phrase of candidates) {
								const phraseLen = Array.from(phrase).length;
								if (!matchedByWordCount[phraseLen]) {
									matchedByWordCount[phraseLen] = [];
								}
								if (!matchedByWordCount[phraseLen].includes(phrase)) {
									matchedByWordCount[phraseLen].push(phrase);
								}
							}
						}
					}
				}
			}
			
			// 也从自定义词库中查询
			try {
				const customStr = localStorage.getItem('CUSTOM_RHYME_BANK');
				if (customStr) {
					const customBank = JSON.parse(customStr);
					if (Array.isArray(customBank)) {
						for (const phrase of customBank) {
							if (typeof phrase === 'string' && phrase.length > 0) {
								// 检查自定义词是否以查询key结尾
								const phraseInfos = Array.from(phrase).map(ch => toInfo(ch)).filter(Boolean);
								if (phraseInfos.length > 0) {
									const lastTwoPhrase = phraseInfos.length >= 2 ? phraseInfos.slice(-2) : phraseInfos;
													const phraseKeyParts = lastTwoPhrase.map(info => `${info.fin}${info.tone}`);
													const phraseKey = phraseKeyParts.join('_');
													const phraseVariants = buildKeyVariants(phraseKey);
													const hit = phraseVariants.some(v => queryVariantSet.has(encodeKey(v)));
									
													if (hit) {
										const phraseLen = Array.from(phrase).length;
										if (!matchedByWordCount[phraseLen]) {
											matchedByWordCount[phraseLen] = [];
										}
										if (!matchedByWordCount[phraseLen].includes(phrase)) {
											matchedByWordCount[phraseLen].push(phrase);
										}
									}
								}
							}
						}
					}
				}
			} catch (e) {
				console.warn('自定义词库读取失败:', e);
			}
			
		// 返回分类结果
		let sortedLengths = Object.keys(matchedByWordCount).map(Number).sort((a, b) => a - b);
		
		const sameLengthResults = [];
		const moreLengthResults = [];
		const lessLengthResults = [];
		
		// 先添加相同字数的匹配
		const sameLengthCandidates = sortedLengths.filter(len => len === sourceLength);
		for (const len of sameLengthCandidates) {
			sameLengthResults.push(...matchedByWordCount[len]);
		}
		
		// 收集少一字的匹配
		const targetLess = sourceLength - 1;
		if (targetLess >= 1 && matchedByWordCount[targetLess]) {
			lessLengthResults.push(...matchedByWordCount[targetLess]);
		}
		
		// 如果没有相同字数的匹配，且源字数大于2，尝试降级查询
		if (sameLengthResults.length === 0 && sourceLength > 2) {
			let currentLength = sourceLength - 1;
			while (currentLength >= 2 && sameLengthResults.length === 0) {
				// 取末尾 currentLength 个字重新查询
				const shorterInfos = infos.slice(-currentLength);
				const shorterResult = queryDict(shorterInfos, looseness);
				
				if (shorterResult && shorterResult.sameLength && shorterResult.sameLength.length > 0) {
					sameLengthResults.push(...shorterResult.sameLength);
					devLog(`降级查询成功：从 ${sourceLength} 字降到 ${currentLength} 字`);
					break;
				}
				
				currentLength--;
			}
		}
		
		// 然后添加所有字数更多的匹配
		const moreLengthCandidates = sortedLengths.filter(len => len > sourceLength);
		for (const len of moreLengthCandidates) {
			moreLengthResults.push(...matchedByWordCount[len]);
		}
		
		return {
			sameLength: sameLengthResults.length > 0 ? sameLengthResults : null,
			lessLength: lessLengthResults.length > 0 ? lessLengthResults : null,
			moreLengths: moreLengthResults.length > 0 ? moreLengthResults : null
		};
	};