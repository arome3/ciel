// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AutopilotRegistry.sol";
import "../src/AutopilotConsumer.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        AutopilotRegistry registry = new AutopilotRegistry();
        AutopilotConsumer consumer = new AutopilotConsumer();

        // Post-deploy setup: bridge consumer → registry
        consumer.setRegistry(address(registry));
        console.log("Consumer registry bridge set to:", address(registry));

        // Authorize consumer to record executions on registry
        registry.addAuthorizedSender(address(consumer));
        console.log("Consumer authorized as registry sender:", address(consumer));

        vm.stopBroadcast();

        // Log deployed addresses
        console.log("AutopilotRegistry deployed to:", address(registry));
        console.log("AutopilotConsumer deployed to:", address(consumer));

        // Save deployment info to JSON
        string memory json = string(
            abi.encodePacked(
                '{"network":"base-sepolia","chainId":84532,',
                '"contracts":{"AutopilotRegistry":"',
                vm.toString(address(registry)),
                '","AutopilotConsumer":"',
                vm.toString(address(consumer)),
                '"}}'
            )
        );
        vm.writeFile("deployments/base-sepolia.json", json);

        console.log("Deployment info saved to deployments/base-sepolia.json");
    }
}
