// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ConsensusConsumer.sol";

contract DeployConsensusConsumer is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        ConsensusConsumer consumer = new ConsensusConsumer();

        vm.stopBroadcast();

        console.log("ConsensusConsumer deployed to:", address(consumer));

        // Save deployment info to JSON
        string memory json = string(
            abi.encodePacked(
                '{"network":"base-sepolia","chainId":84532,',
                '"contracts":{"ConsensusConsumer":"',
                vm.toString(address(consumer)),
                '"}}'
            )
        );
        vm.writeFile("deployments/consensus-consumer.json", json);

        console.log("Deployment info saved to deployments/consensus-consumer.json");
    }
}
